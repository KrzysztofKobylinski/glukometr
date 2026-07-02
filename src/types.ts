export type GlucoseReading = {
  type: "G";
  value: number;
  date: Date;
};

export type DeviceCapabilities = {
  deleteAll: boolean;
  deleteOne: boolean;
};

export type DeviceInfo = {
  label: string;
  serialNumber: string;
  softwareVersion: string;
  glucoseUnits: "mg/dL" | "mmol/L" | "unknown";
  marketLevel?: string;
  patientName?: string;
  patientId?: string;
  clockValid: boolean;
  date?: Date;
  capabilities?: DeviceCapabilities;
};

type RecordBase = {
  id: number;
  recordType: number;
  date: Date;
};

export type GlucoseRecord = RecordBase & { kind: "glucose"; value: number };
export type KetoneRecord = RecordBase & { kind: "ketone"; valueMgDl: number };
export type InsulinRecord = RecordBase & {
  kind: "insulin";
  units: number;
  insulinType: string;
};
export type MeterRecord = GlucoseRecord | KetoneRecord | InsulinRecord;

export interface GlucometerDevice {
  fetchData(): Promise<GlucoseReading[]> | GlucoseReading[];
  fetchAllRecords?(): Promise<MeterRecord[]> | MeterRecord[];
  getInfo?(): Promise<DeviceInfo> | DeviceInfo;
  getCapabilities?(): DeviceCapabilities;
  setDateTime?(date: Date): Promise<void> | void;
  setPatient?(name: string, id?: string): Promise<void> | void;
  deleteAllRecords?(): Promise<void> | void;
  deleteRecord?(id: number, recordType: number): Promise<void> | void;
  close(): void;
}

export type DeviceEntry = {
  path: string;
  label: string;
  create: (path: string) => GlucometerDevice;
};
