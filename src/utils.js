const ncp = require("copy-paste");

async function findElement(driver, selector, timeout = 10000) {
	console.log(`Attempting to find element: ${selector}`);

	try {
		const element = await driver.$(selector);
		await element.waitForDisplayed({ timeout });
		return element;
	} catch (error) {
		console.log(`Failed to find element: ${selector}`);
	}
}

async function typeWithDelay(element, text, delay = 100) {
	for (let char of text) {
		await element.addValue(char);
		await element.pause(delay);
	}
}

function getRandomInt(min, max) {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function scrollDown(driver) {
	const { width, height } = await driver.getWindowSize();

	const startX = getRandomInt(width * 0.4, width * 0.6);
	const startY = getRandomInt(height * 0.7, height * 0.9);
	const endY = getRandomInt(height * 0.2, height * 0.3);
	const duration = getRandomInt(100, 500);

	await driver.performActions([
		{
			type: "pointer",
			id: "finger1",
			parameters: { pointerType: "touch" },
			actions: [
				{ type: "pointerMove", duration: 0, x: startX, y: startY },
				{ type: "pointerDown", button: 0 },
				{ type: "pause", duration: duration },
				{ type: "pointerMove", duration: duration, x: startX, y: endY },
				{ type: "pointerUp", button: 0 },
			],
		},
	]);

	// Random pause after scrolling
	await driver.pause(getRandomInt(500, 2000));
}

async function checkIsLoginScreen(driver) {
	const emailInput = await findElement(
		driver,
		'android=new UiSelector().text("Log in")'
	);

	return !!emailInput;
}

function getClipboardContent() {
	return new Promise((resolve, reject) => {
		ncp.paste((error, content) => {
			if (error) {
				console.error("Error reading clipboard:", error);
				reject(error);
			} else {
				console.log("Clipboard content:", content);
				resolve(content);
			}
		});
	});
}

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

function promisify(fn) {
	return function (...args) {
		return new Promise((resolve, reject) => {
			fn(...args, (error, result) => {
				if (error) {
					reject(error);
				} else {
					resolve(result);
				}
			});
		});
	};
}

async function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
	sleep,
	promisify,
	findElement,
	typeWithDelay,
	getRandomInt,
	scrollDown,
	checkIsLoginScreen,
	getClipboardContent,
	findAndTapElement,
};
