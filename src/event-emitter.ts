/**
 * Inspired by https://danilafe.com/blog/typescript_typesafe_events/
 * but using Map, Set, adding `once` and an async version.
 * `typed-emitter` no longer works properly.
 */
export class FreeSwitchEventEmitter<
  E extends string,
  T extends Record<E, (arg: never) => void>,
> {
  private __on: { [eventName in keyof T]?: Set<T[eventName]> }
  private __once: { [eventName in keyof T]?: Set<T[eventName]> }

  /**
   * Constructs a new event emitter.
   * ```ts
   * const ev = new FreeSwitchEventEmitter<'ping',{ ping: () => console.log('ping\) }>()
   * ```
   */
  constructor(
    private readonly registerEvent?: (event: keyof T) => void,
    private readonly unregisterEvent?: (event: keyof T) => void
  ) {
    this.__on = {}
    this.__once = {}
  }

  /**
   * Send out an event: all registered callbacks are notified.
   */
  emit<K extends keyof T>(event: K, arg: Parameters<T[K]>[0]): boolean {
    const _on = this.__on[event]
    const _once = this.__once[event]
    this.__once[event] = undefined
    const count: number = (_on?.size ?? 0) + (_once?.size ?? 0)
    _on?.forEach((h) => {
      h(arg)
    })
    _once?.forEach((h) => {
      h(arg)
    })
    return count > 0
  }

  /**
   * Register a new callback for the named event.
   * The callback is called every time the event is emitted.
   */
  on<K extends keyof T>(event: K, handler: T[K]): this {
    if (this.registerEvent != null && this.isEmpty(event)) {
      this.registerEvent(event)
    }

    this.__on[event] ??= new Set()
    this.__on[event]?.add(handler)
    return this
  }

  /**
   * Register a new callback for the named event.
   * The callback is only called the first time the event is emitted.
   */
  once<K extends keyof T>(event: K, handler: T[K]): this {
    if (this.registerEvent != null && this.isEmpty(event)) {
      this.registerEvent(event)
    }

    this.__once[event] ??= new Set()
    this.__once[event]?.add(handler)
    return this
  }

  /**
   * Returns a Promise that is resolved the next time the named event is emitted.
   */
  async onceAsync<K extends keyof T>(event: K): Promise<Parameters<T[K]>> {
    // FIXME `as T[K]` might not be needed but I do not know how to address the problem it works around.
    const resolver = (resolve: (_: Parameters<T[K]>) => void): T[K] =>
      ((...args: Parameters<T[K]>): void => {
        resolve(args)
      }) as T[K]
    return await new Promise((resolve) => this.once(event, resolver(resolve)))
  }

  /**
   * Unregister the callback from the named event.
   */
  removeListener<K extends keyof T>(event: K, handler: T[K]): void {
    this.__on[event]?.delete(handler)
    this.__once[event]?.delete(handler)

    if (this.unregisterEvent != null && this.isEmpty(event)) {
      this.unregisterEvent(event)
    }
  }

  /**
   * Unregisters all callbacks from the named event.
   */
  removeAllListeners(): void {
    if (this.unregisterEvent != null) {
      for (const event in this.__on) {
        this.unregisterEvent(event)
      }
      for (const event in this.__once) {
        this.unregisterEvent(event)
      }
    }
    this.__on = {}
    this.__once = {}
  }

  private isEmpty(event: keyof T): boolean {
    const onSize = this.__on[event]?.size ?? 0
    const onceSize = this.__once[event]?.size ?? 0
    return onSize === 0 && onceSize === 0
  }
}

/**
 * Returns a Promise that is resolved the next time the named event is emitted on the emitter.
 */
export const once = async <
  E extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends Record<string, (...args: any[]) => void>,
  K extends keyof T,
>(
  emitter: FreeSwitchEventEmitter<E, T>,
  event: K
): Promise<Parameters<T[K]>> => await emitter.onceAsync(event)

/**
 * Type for event handlers for AbortSignalEventEmitter
 */
export type AbortSignalEvents = {
  abort: (a: undefined) => void
}

/**
 * An event-emitter whose only event is named `abort`.
 */
export type AbortSignalEventEmitter = FreeSwitchEventEmitter<
  keyof AbortSignalEvents,
  AbortSignalEvents
>
