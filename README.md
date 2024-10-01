# Your Package Name

A package for running emulators and scrapers.

## Installation

```bash
npm install your-package-name
```

## Usage

```javascript
const path = require("path");
const {
	startEmulator,
	scraperMain,
	shutdownAll,
} = require("your-package-name");

(async () => {
	try {
		const fileName = path.basename(__filename, ".js");
		const deviceId = await startEmulator(fileName);
		console.log(`Device ID: ${deviceId}`);
		await scraperMain(config, deviceId);
	} catch (error) {
		console.error("An error occurred:", error);
	} finally {
		await shutdownAll();
	}
})();
```
