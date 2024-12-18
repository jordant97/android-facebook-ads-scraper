const { startEmulator, getDeviceIdByName } = require("./src/emulators");
const { scraperMain, shutdownAll, initializeOpenAI } = require("./src/scraper");

module.exports = {
	startEmulator,
	scraperMain,
	shutdownAll,
	initializeOpenAI,
	getDeviceIdByName,
};
