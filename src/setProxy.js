require("dotenv").config();
const axios = require("axios");
const wdio = require("webdriverio");
const OpenAI = require("openai");
const {
	findElement,
	typeWithDelay,
	getRandomInt,
	scrollDown,
	findPostByLikeButton,
	checkIsLoginScreen,
	isViewGroupAPost,
	getClipboardContent,
} = require("./utils");
const { writeFileSync, readFileSync } = require("fs");

const email = "cartraceyxv@hotmail.com";
const password = "A@!xNwL3Fce";
const twoFaCode = "QS7LI2KRYMPNJUHGBEIJKC6EIEMLTNNW";
const proxyHost = "brd.superproxy.io";
const proxyPort = "22225";
const proxyUsername =
	"brd-customer-hl_d86aec88-zone-datacenter_proxy1-ip-103.77.255.108";
const proxyPassword = "t1g6d4jkjzbx";

const capabilities = {
	platformName: "Android",
	"appium:platformVersion": "15.0",
	"appium:deviceName": "Medium Phone API 35 2",
	"appium:udid": "emulator-5556",
	"appium:automationName": "UiAutomator2",
	"appium:noReset": true,
	"appium:fullReset": false,
	"appium:autoLaunch": false,
	"appium:proxy": {
		proxyType: "MANUAL",
		httpProxy: `http://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}`,
		sslProxy: `http://${proxyUsername}:${proxyPassword}@${proxyHost}:${proxyPort}`,
		proxyAutoconfigUrl: "",
		autodetect: false,
	},
	// Enable accessibility testing
	"appium:enableAccessibility": true,
	"appium:disableSuppressAccessibilityService": false,
	"appium:newCommandTimeout": 60 * 10, // 10 minutes
	"appium:autoGrantPermissions": true,
	"appium:automationName": "UiAutomator2",
	"appium:uiautomator2ServerInstallTimeout": 60000, // 60 seconds
	"appium:adbExecTimeout": 60000,
};

async function findAndTapElement(driver, text) {
	try {
		const element = await driver.$(`android=new UiSelector().text("${text}")`);
		await element.waitForExist({ timeout: 10000 });
		await element.click();
		console.log(`Successfully tapped on "${text}"`);
	} catch (error) {
		console.error(`Failed to find or tap on "${text}":`, error);
		throw error;
	}
}

async function launchSettings() {
	let driver;

	const successfulDescriptions = [];
	let retries = 10;

	try {
		console.log("Attempting to connect to Appium server...");
		console.log("Capabilities:", JSON.stringify(capabilities, null, 2));

		driver = await wdio.remote({
			protocol: "http",
			hostname: "localhost",
			port: 4723,
			path: "/",
			capabilities: capabilities,
			logLevel: "debug", // debug / warn / info
			proxy: {
				proxyType: "manual",
				httpProxy: `${proxyHost}:${proxyPort}`,
				sslProxy: `${proxyHost}:${proxyPort}`,
				proxyAuth: `${proxyUsername}:${proxyPassword}`,
			},
		});

		console.log("Session created successfully");
		await driver.activateApp("com.android.settings");
		await driver.pause(getRandomInt(5000, 10000));

		const isAppRunning = await driver.isAppInstalled("com.android.settings");

		if (!isAppRunning) {
			console.log("App is not running. Exiting...");
			return;
		}

		console.log("App launched successfully");
		await driver.pause(getRandomInt(3000, 6000));

		// Tap on "Network & internet"
		await findAndTapElement(driver, "Network & internet");

		// Wait for a moment to ensure the new screen has loaded
		await driver.pause(getRandomInt(3000, 6000));

		await findAndTapElement(driver, "Internet");

		await driver.pause(getRandomInt(5000, 10000));
		// Toggle Wi-Fi off
		const wifiToggle = await driver.$(
			'android=new UiSelector().className("android.widget.Switch")'
		);
		const isWifiOn = await wifiToggle.getAttribute("checked");
		if (isWifiOn === "true") {
			await wifiToggle.click();
			console.log("Wi-Fi toggled off");
			await driver.pause(getRandomInt(3000, 6000));
		} else {
			console.log("Wi-Fi is already off");
		}

		const settings = await driver.$$("~Settings");
		await settings[0].click();

		await driver.pause(getRandomInt(3000, 6000));

		const { height } = await driver.getWindowSize();

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
						y: height - 200,
					},
					{ type: "pointerDown", button: 0 },
					{ type: "pause", duration: 100 },
					{
						type: "pointerMove",
						duration: 100,
						x: 200,
						y: height - 200 - 500,
					},
					{ type: "pointerUp", button: 0 },
				],
			},
		]);

		await findAndTapElement(driver, "Access Point Names");
	} catch (error) {
		console.error(`Attempt ${4 - retries} failed:`, error);
		retries--;
		if (retries > 0) {
			console.log(`Retrying... (${retries} attempts left)`);
			// Wait for a bit before retrying
			await new Promise((resolve) => setTimeout(resolve, 5000));
		}
	} finally {
		if (driver) {
			try {
				await driver.deleteSession();
			} catch (deleteError) {
				console.error("Error deleting session:", deleteError);
			}
		}
	}

	console.log(
		`Total successful descriptions: ${successfulDescriptions.length}`
	);
}

(async () => {
	console.log("Node version:", process.version);
	console.log("ANDROID_HOME:", process.env.ANDROID_HOME);
	console.log("JAVA_HOME:", process.env.JAVA_HOME);

	await launchSettings();
})();
