export type ServiceCommand = [executable: string, args: string[]];

export function resolveServiceCommands(env?: NodeJS.ProcessEnv): ServiceCommand[];
