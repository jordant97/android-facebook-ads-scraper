require("dotenv").config();
const axios = require("axios");
const wdio = require("webdriverio");
const OpenAI = require("openai");
const { findElement, getRandomInt, getClipboardContent } = require("./utils");
const { writeFileSync, readFileSync } = require("fs");
const { spawn } = require("child_process");

let appiumServerMap = new Map();
let driverMap = new Map();

async function smoothScroll(driver, distance) {
	const { height } = await driver.getWindowRect();

	try {
		const result = await driver.executeScript("mobile: scrollGesture", [
			{
				left: 100,
				top: Math.min(height - 300, height * 0.7), // Adjust starting position
				width: 200,
				height: 600,
				direction: "down", // Change direction to up since we're scrolling content upward
				percent: 0.8,
				speed: 1500, // Slightly reduced speed for better reliability
			},
		]);

		return result; // Returns true if scroll was successful
	} catch (error) {
		console.log("Scroll failed:", error.message);
		return false;
	}
}

const capabilities = {
	platformName: "Android",
	"appium:automationName": "UiAutomator2",
	"appium:appPackage": "com.facebook.katana",
	"appium:appActivity": "com.facebook.katana.activity.FbMainTabActivity",
	"appium:noReset": true,
	"appium:fullReset": false,
	"appium:autoGrantPermissions": true,
	"appium:allowTestPackages": true,
	"appium:enforceAppInstall": true,
	"appium:settings[settingsResetTimeout]": 30000,
	"appium:skipServerInstallation": false,
	"appium:skipDeviceInitialization": false,
	"appium:ignoreHiddenApiPolicyError": true,
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

async function validateAndGetDriver(deviceId, capabilities, port) {
	let driver = driverMap.get(deviceId);

	if (driver) {
		try {
			// Test if the session is still valid
			await driver.getStatus();
			return driver;
		} catch (error) {
			console.log("Existing driver session invalid, cleaning up...");
			try {
				await driver.deleteSession();
			} catch (cleanupError) {
				console.error("Error cleaning up invalid session:", cleanupError);
			}
			driverMap.delete(deviceId);
			driver = null;
		}
	}

	// Create new driver if needed
	driver = await createDriver(deviceId, capabilities, port);
	return driver;
}

async function launchFacebookApp(config, deviceId, port) {
	let totalPost = config.totalPost;
	const successfulDescriptions = [];
	let retries = 100;

	let driver;

	const _capabilities = {
		...capabilities,
		"appium:udid": deviceId,
	};

	while (retries > 0) {
		try {
			console.log("Attempting to connect to Appium server...");
			console.log("Capabilities:", JSON.stringify(_capabilities, null, 2));

			driver = await validateAndGetDriver(deviceId, capabilities, port);

			driver.updateSettings({
				waitForIdleTimeout: 500,
			});

			const { height } = await driver.getWindowRect();

			console.log("Session created successfully");
			await driver.activateApp("com.facebook.katana");
			await driver.pause(getRandomInt(2000, 5000));

			const isAppRunning = await driver.isAppInstalled("com.facebook.katana");
			console.log("Is Facebook app running?", isAppRunning);

			if (!isAppRunning) {
				console.log("App is not running. Exiting...");
				return;
			}

			console.log("App launched successfully");
			await driver.pause(getRandomInt(2000, 5000));

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
					console.log("Found posts:", posts.length);

					for (let j = 0; j < posts.length; j++) {
						const currentPost = posts[j];

						// Check for hide ad button in both languages
						const [hideAdResult, hideAdChineseResult] =
							await Promise.allSettled([
								currentPost.$$("~Hide ad"),
								currentPost.$$("~隐藏广告"),
							]);

						const hasAd =
							(hideAdResult.status === "fulfilled" &&
								hideAdResult.value.length > 0) ||
							(hideAdChineseResult.status === "fulfilled" &&
								hideAdChineseResult.value.length > 0);

						if (hasAd) {
							// Get the bounds of the ad post
							const bounds = await currentPost.getAttribute("bounds");
							const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);

							if (!match) {
								console.log("Failed to parse bounds, skipping post");
								continue;
							}

							const [, , currentY] = match.map(Number);
							console.log("Found ad post at Y:", currentY);

							// Scroll until the post is near the top (Y < 300)
							while (currentY > 300) {
								const scrolled = await smoothScroll(driver, 300);
								if (!scrolled) {
									console.log("Scroll failed, breaking");
									break;
								}
								await driver.pause(500); // Wait for scroll to settle

								// Re-check position after scroll
								const newBounds = await currentPost.getAttribute("bounds");
								const newMatch = newBounds.match(
									/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/
								);
								if (!newMatch) break;
								const [, , newY] = newMatch.map(Number);

								if (newY < 300) {
									// Post is in position, proceed with screenshot and analysis
									const screenshot = await driver.takeScreenshot();
									const screenshotPath = `./${deviceId}.png`;
									writeFileSync(screenshotPath, screenshot, "base64");

									await driver.pause(getRandomInt(1400, 3000));
									const analysisResult = await analyzeScreenshotWithOpenAI(
										screenshotPath
									);
									console.log("OpenAI Analysis Result:", analysisResult);

									if (analysisResult.isRelated) {
										// Process share and copy link functionality
										await processShareAndCopyLink(
											driver,
											currentPost,
											deviceId
										);
									}
									break;
								}
							}
						}
					}

					// Scroll for next iteration if needed
					await smoothScroll(driver, 500);
					await driver.pause(getRandomInt(500, 1000));
				} catch (e) {
					console.error(`Error processing post ${i}:`, e);
					// Optionally, you can try to recover here, e.g., by restarting the app
					await driver.activateApp("com.facebook.katana"); // Restart the app in case of an error
					await driver.pause(getRandomInt(5000, 10000)); // Pause before retrying
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

// Helper function to handle share and copy link functionality
async function processShareAndCopyLink(driver, post, deviceId) {
	// Find and click share button
	const shareButtonEnglish = await post.$$("~Share");
	const shareButtonChinese = await post.$$("~分享");

	if (shareButtonEnglish.length === 0 && shareButtonChinese.length === 0) {
		console.log("No share button found");
		return;
	}

	const shareButton =
		shareButtonEnglish.length > 0 ? shareButtonEnglish : shareButtonChinese;
	await shareButton[0].click();
	await driver.pause(getRandomInt(2000, 5000));

	// Find and click copy link button
	const copyLinkButtonEnglish = await driver.$$("~Copy link");
	const copyLinkButtonChinese = await driver.$$("~复制链接");
	const copyLinkButton =
		copyLinkButtonEnglish.length > 0
			? copyLinkButtonEnglish
			: copyLinkButtonChinese;

	if (copyLinkButton.length === 0) {
		const closeButton = await findCloseButton(driver);
		if (closeButton) await closeButton.click();
		return;
	}

	await copyLinkButton[0].click();
	await driver.pause(getRandomInt(2000, 5000));

	// Handle clipboard content
	const clipboardContent = await getClipboardContent();
	if (clipboardContent) {
		await axios.post("https://rpa-gpt.b1ueprint.com/api/records3", {
			url: clipboardContent,
			postId: `-`,
			lastCommented: 0,
			commentLimit: 0,
			accountId: deviceId,
		});
	}
}

// Helper function to find close button
async function findCloseButton(driver) {
	const closeButtonEnglish = await driver.$$("~Close");
	const closeButtonChinese = await driver.$$("~关闭");
	return closeButtonEnglish.length > 0
		? closeButtonEnglish[0]
		: closeButtonChinese.length > 0
		? closeButtonChinese[0]
		: null;
}

async function createDriver(deviceId, capabilities, port) {
	const serverInfo = appiumServerMap.get(deviceId);
	if (!serverInfo) {
		throw new Error(`No Appium server found for device ${deviceId}`);
	}

	// const driver = await wdio.remote({
	// 	protocol: "http",
	// 	hostname: "localhost",
	// 	port: parseInt(deviceId.split("-")[1]) - 1000,
	// 	path: "/",
	// 	capabilities: _capabilities,
	// 	logLevel: "error",
	// });

	console.log("deviceId", deviceId);

	const driver = await wdio.remote({
		hostname: "127.0.0.1",
		port: port,
		logLevel: "error",
		capabilities: capabilities,
	});

	driverMap.set(deviceId, driver);
	return driver;
}

async function closeApp(deviceId) {
	const driver = driverMap.get(deviceId);
	if (driver) {
		try {
			await driver.terminateApp("com.facebook.katana");
			await cleanupResources(driver, deviceId);
			await driver.pause(2000);

			// Clear the driver from memory
			driverMap.delete(deviceId);

			console.log(`Facebook app closed and cleaned up for device ${deviceId}`);
		} catch (error) {
			console.error(
				`Error closing Facebook app for device ${deviceId}:`,
				error
			);
		}
	}
}

function startAppiumServer(deviceId, port) {
	return new Promise((resolve, reject) => {
		console.log("Starting Appium server...", port);

		let appium;
		try {
			appium = spawn(
				process.env.APPIUM_PATH || "appium",
				[
					"server", // Add this
					"--use-drivers",
					"uiautomator2",
					"--address",
					"127.0.0.1",
					"--port",
					port.toString(),
					"--base-path",
					"/", // Changed from /wd/hub
					"--allow-insecure",
					"chromedriver_autodownload",
					"--session-override", // Add this
				],
				{
					stdio: ["pipe", "pipe", "pipe"],
					shell: true,
				}
			);
		} catch (error) {
			console.error(`Failed to spawn Appium process: ${error.message}`);
			return reject(error);
		}

		if (!appium || !appium.stdout || !appium.stderr) {
			console.error("Failed to create Appium process or its streams");
			return reject(new Error("Appium process creation failed"));
		}

		appium.stdout.on("data", (data) => {
			const output = data.toString();
			console.log(`Appium (${deviceId}): ${output}`);
			if (output.includes("Appium REST http interface listener started")) {
				appiumServerMap.set(deviceId, { server: appium, port: port });
				console.log(
					`Appium server for device ${deviceId} started successfully on port ${port}`
				);
				resolve(appium);
			}
		});

		appium.stderr.on("data", (data) => {
			console.error(`Appium Error (${deviceId}): ${data.toString()}`);
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

		// Add a timeout to reject the promise if Appium doesn't start within 30 seconds
		setTimeout(() => {
			if (!appiumServerMap.has(deviceId)) {
				console.error(
					`Appium server for device ${deviceId} failed to start within 30 seconds`
				);
				if (appium) {
					appium.kill();
				}
				reject(new Error("Appium server start timeout"));
			}
		}, 30000);
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

async function scraperMain(config, deviceId, port) {
	console.log("Node version:", process.version);
	console.log("ANDROID_HOME:", process.env.ANDROID_HOME);
	console.log("JAVA_HOME:", process.env.JAVA_HOME);

	try {
		await startAppiumServer(deviceId, port);
		await launchFacebookApp(config, deviceId, port);
	} catch (error) {
		console.error("Error in scraperMain:", error);
	} finally {
		await stopAppiumServer(deviceId);
	}
}

// 6. Update shutdownAll to properly clean everything
async function shutdownAll() {
	for (const [deviceId, driver] of driverMap.entries()) {
		try {
			await closeApp(deviceId);
			await cleanupResources(driver, deviceId);
			await driver.deleteSession();
		} catch (error) {
			console.error(`Error shutting down device ${deviceId}:`, error);
		}
	}

	driverMap.clear();
	appiumServerMap.clear();

	// Force garbage collection
	if (global.gc) {
		global.gc();
	}
}

module.exports = {
	scraperMain,
	shutdownAll,
	initializeOpenAI,
};
