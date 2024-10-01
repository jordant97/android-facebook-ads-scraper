require("dotenv").config();
const axios = require("axios");
const wdio = require("webdriverio");
const OpenAI = require("openai");
const { findElement, getRandomInt, getClipboardContent } = require("./utils");
const { writeFileSync, readFileSync } = require("fs");
const { spawn } = require("child_process");

let appiumServerMap = new Map();
let driverMap = new Map();

const capabilities = {
	platformName: "Android",
	"appium:platformVersion": "15.0",
	"appium:automationName": "UiAutomator2",
	"appium:appPackage": "com.facebook.katana",
	"appium:appActivity": "com.facebook.katana.activity.FbMainTabActivity",
	"appium:noReset": true,
	"appium:fullReset": false,
	"appium:autoLaunch": false,
	"appium:enableAccessibility": true,
	"appium:disableSuppressAccessibilityService": false,
	"appium:newCommandTimeout": 60 * 10, // 10 minutes
	"appium:autoGrantPermissions": true,
	"appium:uiautomator2ServerInstallTimeout": 60000, // 60 seconds
	"appium:adbExecTimeout": 60000,
};

let openai;

function initializeOpenAI(apiKey) {
	openai = new OpenAI({ apiKey });
}

async function analyzeScreenshotWithOpenAI(screenshotPath) {
	try {
		const imageBuffer = readFileSync(screenshotPath);
		const base64Image = imageBuffer.toString("base64");

		const response = await openai.chat.completions.create({
			model: "gpt-4o-mini",
			max_tokens: 1000,
			messages: [
				{
					role: "system",
					content: `Analyze the image, focusing primarily on the main post (the one that takes up most of the screen or the one that is at the top of the screen). Ignore any other content outside the main post. Respond with a JSON object: {isRelated: boolean, reason: string, profileName: string}. Keep the reason concise. For a post to be considered isRelated: 
						1. It should have a clear 'Sponsored' label (it can be in any language), typically at the top of the post. Ignore any other content outside the main post.
						2. It should be about gambling. (it can be in any language)
						3. Only gambling related to online casinos, sports betting are considered related.
					`,
				},
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Is this a sponsored post and related to gambling?",
						},
						{
							type: "image_url",
							image_url: {
								url: `data:image/png;base64,${base64Image}`,
							},
						},
					],
				},
			],
			response_format: { type: "json_object" },
		});

		console.log("Raw OpenAI response:", response.choices[0].message.content);

		try {
			return JSON.parse(response.choices[0].message.content);
		} catch (parseError) {
			console.error("Error parsing OpenAI response:", parseError);
			console.log("Unparsed response:", response.choices[0].message.content);
			return { isRelated: false, reason: "Error parsing OpenAI response" };
		}
	} catch (error) {
		console.error("Error analyzing screenshot with OpenAI:", error);
		return { isRelated: false, reason: "Error analyzing image" };
	}
}

async function launchFacebookApp(config, deviceId) {
	let totalPost = config.totalPost;
	const successfulDescriptions = [];
	let retries = 100;
	let processedPosts = 0;

	let driver;

	const _capabilities = {
		...capabilities,
		"appium:udid": deviceId,
	};

	while (retries > 0) {
		try {
			console.log("Attempting to connect to Appium server...");
			console.log("Capabilities:", JSON.stringify(_capabilities, null, 2));

			driver = driverMap.get(deviceId);
			if (!driver) {
				driver = await createDriver(deviceId, capabilities);
			}

			const { height } = await driver.getWindowRect();

			console.log("Session created successfully");
			await driver.activateApp("com.facebook.katana");
			await driver.pause(getRandomInt(5000, 10000));

			const isAppRunning = await driver.isAppInstalled("com.facebook.katana");
			console.log("Is Facebook app running?", isAppRunning);

			if (!isAppRunning) {
				console.log("App is not running. Exiting...");
				return;
			}

			console.log("App launched successfully");
			await driver.pause(getRandomInt(3000, 6000));

			// Find the RecyclerView (adjust selector if needed)
			const recyclerViewSelector =
				'android=new UiSelector().className("androidx.recyclerview.widget.RecyclerView")';

			await driver.pause(getRandomInt(3000, 6000));
			const recyclerView = await findElement(driver, recyclerViewSelector);

			if (!recyclerView) {
				throw new Error("Failed to find RecyclerView");
			}

			for (let i = 0; i < totalPost; i++) {
				try {
					const directPath = "./*/android.view.ViewGroup";

					const posts = await recyclerView.$$(directPath);

					for (let i = 0; i < posts.length; i++) {
						if (i === posts.length - 1) {
							const post = posts[i];
							const bounds = await post.getAttribute("bounds");

							console.log("before bounds", bounds);

							const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
							if (!match) {
								console.log("Failed to parse bounds");
								continue;
							}

							const [, , currentY] = match.map(Number);
							const targetY = 200;
							let scrollDistance = currentY - targetY;
							// Get screen size

							// Define scroll parameters
							const scrollDuration = 2000; // Duration of scroll in milliseconds

							const distancePerTimes = 1000;
							const times = Math.ceil(scrollDistance / distancePerTimes);

							if (currentY <= 150) {
								await driver.performActions([
									{
										type: "pointer",
										id: "finger1",
										parameters: { pointerType: "touch" },
										actions: [
											{
												type: "pointerMove",
												duration: 0,
												x: 200,
												y: height / 2,
											},
											{ type: "pointerDown", button: 0 },
											{ type: "pause", duration: 100 },
											{
												type: "pointerMove",
												duration: scrollDuration,
												x: 200,
												y: height / 2 - 300,
											},
											{ type: "pointerUp", button: 0 },
										],
									},
								]);

								await driver.pause(scrollDuration); // Wait for scroll to complete and a bit more
								continue;
							}

							for (let i = 0; i < times; i++) {
								if (scrollDistance <= 0) {
									break;
								}

								await driver.performActions([
									{
										type: "pointer",
										id: "finger1",
										parameters: { pointerType: "touch" },
										actions: [
											{
												type: "pointerMove",
												duration: 0,
												x: 200,
												y: height / 2,
											},
											{ type: "pointerDown", button: 0 },
											{ type: "pause", duration: 100 },
											{
												type: "pointerMove",
												duration:
													scrollDistance <= distancePerTimes
														? scrollDistance * 2
														: distancePerTimes * 2,
												x: 200,
												y:
													height / 2 -
													(scrollDistance <= distancePerTimes
														? scrollDistance
														: distancePerTimes),
											},
											{ type: "pointerUp", button: 0 },
										],
									},
								]);

								await driver.pause(scrollDuration); // Wait for scroll to complete and a bit more

								scrollDistance -= distancePerTimes;
							}
						}
					}

					const currentFocusPost = posts[posts.length - 1];
					const isAds = await currentFocusPost.$$("~Hide ad");

					if (isAds.length === 0) {
						continue;
					}

					const screenshot = await driver.takeScreenshot();
					const screenshotPath = `./screenshot.png`;

					await driver.pause(getRandomInt(2000, 4000));
					writeFileSync(screenshotPath, screenshot, "base64");
					console.log(`Screenshot saved to: ${screenshotPath}`);

					await driver.pause(getRandomInt(1400, 3000));
					// Analyze the screenshot with OpenAI
					const analysisResult = await analyzeScreenshotWithOpenAI(
						screenshotPath
					);
					console.log("OpenAI Analysis Result:", analysisResult);

					if (!analysisResult.isRelated) {
						console.log("Post is not sponsored");
						continue;
					}

					const shareButton = await currentFocusPost.$$("~Share");

					if (shareButton.length === 0) {
						continue;
					}

					await shareButton[0].click();

					const copyLinkButton = await driver.$$("~Copy link");
					await driver.pause(getRandomInt(2000, 5000));

					console.log("copyLinkButton", copyLinkButton);

					if (copyLinkButton.length === 0) {
						const closeButton = await driver.$$("~Close");
						await closeButton[0].click();
						continue;
					}

					await copyLinkButton[0].click();
					await driver.pause(getRandomInt(2000, 5000));

					const clipboardContent = await getClipboardContent();
					console.log("clipboardContent", clipboardContent);

					await axios.post("https://rpa-gpt.vercel.app/api/records", {
						url: clipboardContent,
						postId: `-`,
						lastCommented: 0,
						commentLimit: 0,
						accountId: "mobileFb",
					});

					await driver.pause(getRandomInt(2000, 5000));
				} catch (postError) {
					console.error(`Error processing post ${i}:`, postError);
					// Optionally, you can try to recover here, e.g., by restarting the app
					await driver.activateApp("com.facebook.katana");
					await driver.pause(getRandomInt(5000, 10000));
				}
			}

			// If we've made it this far, we've succeeded
			break;
		} catch (error) {
			console.error(`Attempt ${4 - retries} failed:`, error);
			retries--;
			if (retries > 0) {
				console.log(`Retrying... (${retries} attempts left)`);
				// Wait for a bit before retrying
				await new Promise((resolve) => setTimeout(resolve, 5000));
			}
		} finally {
			await closeApp(deviceId);
			const driver = driverMap.get(deviceId);
			if (driver) {
				await driver.deleteSession();
				driverMap.delete(deviceId);
			}
		}
	}

	console.log(
		`Total successful descriptions: ${successfulDescriptions.length}`
	);
}

async function createDriver(deviceId, capabilities) {
	const _capabilities = {
		...capabilities,
		"appium:udid": deviceId,
	};

	const serverInfo = appiumServerMap.get(deviceId);
	if (!serverInfo) {
		throw new Error(`No Appium server found for device ${deviceId}`);
	}

	const driver = await wdio.remote({
		protocol: "http",
		hostname: "localhost",
		port: serverInfo.port,
		path: "/",
		capabilities: _capabilities,
		logLevel: "warn",
	});

	driverMap.set(deviceId, driver);
	return driver;
}

async function closeApp(deviceId) {
	const driver = driverMap.get(deviceId);
	if (driver) {
		try {
			await driver.terminateApp("com.facebook.katana");
			console.log(`Facebook app closed successfully for device ${deviceId}`);
		} catch (error) {
			console.error(
				`Error closing Facebook app for device ${deviceId}:`,
				error
			);
		}
	}
}

function getPortFromDeviceId(deviceId) {
	const numericPart = parseInt(deviceId.split("-")[1]);
	return numericPart + 1000; // Ensures port is between 4723 and 5722
}

function startAppiumServer(deviceId) {
	return new Promise((resolve, reject) => {
		function getPortFromDeviceId(deviceId) {
			const numericPart = parseInt(deviceId.split("-")[1]);
			return (numericPart % 1000) + 4723; // Ensures port is between 4723 and 5722
		}

		const port = getPortFromDeviceId(deviceId);
		console.log("Starting Appium server...");
		const appium = spawn("npx", [
			"appium",
			"--use-drivers",
			"uiautomator2",
			"-p",
			port.toString(),
		]);

		appium.stdout.on("data", (data) => {
			console.log(`Appium (${deviceId}): ${data}`);
			if (data.includes("Appium REST http interface listener started")) {
				appiumServerMap.set(deviceId, { server: appium, port: port });
				console.log(
					`Appium server for device ${deviceId} started successfully on port ${port}`
				);
				resolve(appium);
			}
		});

		appium.stderr.on("data", (data) => {
			console.error(`Appium Error (${deviceId}): ${data}`);
		});

		appium.on("error", (error) => {
			console.error(
				`Failed to start Appium server for device ${deviceId}:`,
				error
			);
			reject(error);
		});

		appium.on("close", (code) => {
			console.log(
				`Appium process for device ${deviceId} exited with code ${code}`
			);
			appiumServerMap.delete(deviceId);
		});
	});
}

function stopAppiumServer(deviceId) {
	return new Promise((resolve) => {
		const serverInfo = appiumServerMap.get(deviceId);
		if (serverInfo) {
			console.log(`Stopping Appium server for device ${deviceId}...`);
			serverInfo.server.kill();
			serverInfo.server.on("close", () => {
				console.log(`Appium server for device ${deviceId} stopped`);
				appiumServerMap.delete(deviceId);
				resolve();
			});
		} else {
			console.log(`No Appium server to stop for device ${deviceId}`);
			resolve();
		}
	});
}

async function scraperMain(config, deviceId) {
	console.log("Node version:", process.version);
	console.log("ANDROID_HOME:", process.env.ANDROID_HOME);
	console.log("JAVA_HOME:", process.env.JAVA_HOME);

	try {
		await startAppiumServer(deviceId);
		await launchFacebookApp(config, deviceId);
	} catch (error) {
		console.error("Error in scraperMain:", error);
	} finally {
		await stopAppiumServer();
	}
}

async function shutdownAll() {
	// for (const [deviceId, driver] of driverMap.entries()) {
	// 	await closeApp(deviceId);
	// 	await driver.deleteSession();
	// }
	// driverMap.clear();
	// appiumServerMap.clear();
	// await stopAppiumServer();
}

module.exports = {
	scraperMain,
	shutdownAll,
	initializeOpenAI,
};
