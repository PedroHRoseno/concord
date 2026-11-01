declare module 'discord-rpc' {
  export class Client {
    constructor(options: { transport: 'ipc' })
    on(event: 'ready', listener: () => void): void
    login(options: { clientId: string }): Promise<void>
    setActivity(activity: {
      details?: string
      state?: string
      startTimestamp?: number
      instance?: boolean
    }): Promise<unknown>
    clearActivity(): Promise<unknown>
    destroy(): Promise<void>
  }
}
