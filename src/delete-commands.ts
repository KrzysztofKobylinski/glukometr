const DELETE_ALL_COMMANDS = [
  "$erase",
  "$zero",
  "$clear",
  "$dellog",
  "$clog",
  "$memclr",
  "$clrmem",
  "$clrlog",
  "$zerolog",
  "$eraselog",
  "$resultclr",
  "$xclr",
  "$clrx",
];

export function deleteAllCommands(): string[] {
  return [...DELETE_ALL_COMMANDS];
}

export function deleteOneCommands(id: number, recordType: number): string[] {
  return [
    `$dresult,${id}`,
    `$dresult,${id},${recordType}`,
    `$delresult,${id}`,
    `$delresult,${id},${recordType}`,
    `$eraseresult,${id}`,
    `$eraseresult,${id},${recordType}`,
    `$del,${id}`,
    `$rm,${id}`,
    `$resultdel,${id}`,
    `$logdel,${id}`,
    `$dlog,${id}`,
  ];
}

export function tryTextCommand(
  send: (command: string) => boolean,
  commands: string[],
): boolean {
  for (const command of commands) {
    if (send(command)) {
      return true;
    }
  }
  return false;
}
