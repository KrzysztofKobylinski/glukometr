export type GlucoseReading = {
  type: "G";
  value: number;
  date: Date;
};

export interface GlucometerDevice {
  fetchData(): Promise<GlucoseReading[]> | GlucoseReading[];
  close(): void;
}

export type DeviceEntry = {
  path: string;
  label: string;
  create: (path: string) => GlucometerDevice;
};
