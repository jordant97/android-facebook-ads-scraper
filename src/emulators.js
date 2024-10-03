const { execSync } = require("child_process");
const { spawn } = require("cross-spawn");
const path = require("path");
const { sleep } = require("./utils");

function listEmulators() {
	try {
		const stdout = execSync("emulator -list-avds", { encoding: "utf-8" });
		const emulators = stdout.trim().split("\n").filter(Boolean);
		console.log("Available emulators:", emulators);
		return emulators;
	} catch (error) {
		console.error("Error listing emulators:", error);
		return [];
	}
}

function getEmulatorDeviceId() {
	try {
		const stdout = execSync("adb devices", { encoding: "utf-8" });

		const lines = stdout.trim().split("\n");
		// Remove the first line (header) and filter out empty lines
		const devices = lines.slice(1).filter((line) => line.trim() !== "");

		if (devices.length > 0) {
			// Get the last device in the list
			const lastDevice = devices[devices.length - 1];
			const deviceInfo = lastDevice.split("\t");
			return deviceInfo[0];
		}
		throw new Error("No emulator device found", JSON.stringify(devices));
	} catch (error) {
		console.error("Error getting emulator device ID:", error);
		throw error;
	}
}
async function startEmulator(emulatorName) {
	try {
		const emulators = await listEmulators();

		if (emulators.includes(emulatorName)) {
			await spawn(
				process.env.EMULATOR_PATH || "emulator",
				["-avd", emulatorName],
				{
					stdio: "inherit",
					shell: true,
				}
			);
			await sleep(2000);
			const deviceId = await getEmulatorDeviceId();
			return deviceId;
		} else {
			return null;
		}
	} catch (error) {
		console.error("An error occurred:", error);
	}
}

module.exports = {
	listEmulators,
	getEmulatorDeviceId,
	startEmulator,
};
