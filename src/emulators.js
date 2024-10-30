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

async function getEmulatorDeviceId(retries = 2) {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const stdout = execSync("adb devices", { encoding: "utf-8" });

			const lines = stdout.trim().split("\n");
			// Remove the first line (header) and filter out empty lines
			const devices = lines.slice(1).filter((line) => line.trim() !== "");

			console.log("devices in getEmulatorDeviceId", devices);

			if (devices.length > 0) {
				// Get the last device in the list
				const lastDevice = devices[devices.length - 1];
				const deviceInfo = lastDevice.split("\t");
				return deviceInfo[0];
			}

			if (attempt === retries) {
				throw new Error("No emulator device found", JSON.stringify(devices));
			}

			console.log(`Retry attempt ${attempt + 1} of ${retries + 1}`);
			await sleep(2000); // Wait for 2 seconds before retrying
		} catch (error) {
			if (attempt === retries) {
				console.error("Error getting emulator device ID:", error);

				// Execute the specified commands
				try {
					execSync("adb kill-server", { stdio: "inherit" });
					execSync("adb start-server", { stdio: "inherit" });
					execSync("adb devices", { stdio: "inherit" });
				} catch (cmdError) {
					console.error("Error executing ADB commands:", cmdError);
				}

				throw error;
			}

			console.log(`Retry attempt ${attempt + 1} of ${retries + 1}`);
			await sleep(2000); // Wait for 2 seconds before retrying
		}
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
			console.time("start");
			await sleep(5000);
			console.timeEnd("start");
			const deviceId = await getEmulatorDeviceId();
			return deviceId;
		} else {
			return null;
		}
	} catch (error) {
		console.error("An error occurred:", error);
	}
}

function getDeviceIdByName(searchName) {
	try {
		const devicesOutput = execSync("adb devices", { encoding: "utf-8" });

		const deviceIds = devicesOutput
			.split("\n")
			.slice(1)
			.filter((line) => line.includes("device"))
			.map((line) => line.split("\t")[0])
			.filter((id) => id);

		// Search through each device
		for (const deviceId of deviceIds) {
			try {
				const deviceName = execSync(
					`adb -s ${deviceId} shell settings get global device_name`,
					{ encoding: "utf-8" }
				).trim();

				if (deviceName.toLowerCase().includes(searchName.toLowerCase())) {
					return {
						id: deviceId,
						name: deviceName,
					};
				}
			} catch (err) {
				// Silent fail for individual device errors
				continue;
			}
		}
		return null;
	} catch (error) {
		return null;
	}
}

module.exports = {
	listEmulators,
	getEmulatorDeviceId,
	startEmulator,
	getDeviceIdByName,
};
