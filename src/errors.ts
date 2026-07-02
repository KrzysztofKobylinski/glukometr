export class GlucometerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GlucometerError";
  }
}

export class DeviceNotConnected extends GlucometerError {
  constructor(message = "Device not responding") {
    super(message);
    this.name = "DeviceNotConnected";
  }
}

export class DeviceInvalid extends GlucometerError {
  constructor(message = "Invalid device response") {
    super(message);
    this.name = "DeviceInvalid";
  }
}

export class DeleteNotSupported extends GlucometerError {
  constructor(
    message = "This device does not support deleting readings over USB. Clear memory from the device menu instead.",
  ) {
    super(message);
    this.name = "DeleteNotSupported";
  }
}
