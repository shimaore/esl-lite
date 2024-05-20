// Inspired by https://danilafe.com/blog/typescript_typesafe_events/
// but using Map, Set, adding `once` and an async version.
// `typed-emitter` no longer works properly.

export class FreeSwitchEventEmitter<
  E extends string,
  T extends Record<E, (arg: never) => void>,
> {
  private __on: { [eventName in keyof T]?: Set<T[eventName]> }
  private __once: { [eventName in keyof T]?: Set<T[eventName]> }

  constructor() {
    this.__on = {}
    this.__once = {}
  }

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

  on<K extends keyof T>(event: K, handler: T[K]): this {
    if (this.__on[event] == null) {
      this.__on[event] = new Set()
    }
    this.__on[event]?.add(handler)
    return this
  }

  once<K extends keyof T>(event: K, handler: T[K]): this {
    if (this.__once[event] == null) {
      this.__once[event] = new Set()
    }
    this.__once[event]?.add(handler)
    return this
  }

  async __onceAsync<K extends keyof T>(event: K): Promise<Parameters<T[K]>> {
    // FIXME `as T[K]` might not be needed but I do not know how to address the problem it works around.
    const resolver = (resolve: (_: Parameters<T[K]>) => void): T[K] =>
      ((...args: Parameters<T[K]>): void => {
        resolve(args)
      }) as T[K]
    return await new Promise((resolve) => this.once(event, resolver(resolve)))
  }

  removeListener<K extends keyof T>(event: K, handler: T[K]): void {
    this.__on[event]?.delete(handler)
    this.__once[event]?.delete(handler)
  }

  removeAllListeners(): void {
    this.__on = {}
    this.__once = {}
  }
}

export const once = async <
  E extends string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends Record<string, (...args: any[]) => void>,
  K extends keyof T,
>(
  emitter: FreeSwitchEventEmitter<E, T>,
  event: K
): Promise<Parameters<T[K]>> => await emitter.__onceAsync(event)

interface AbortSignalEvents {
  abort: (a: undefined) => void
}

export type AbortSignalEventEmitter = FreeSwitchEventEmitter<
  keyof AbortSignalEvents,
  AbortSignalEvents
>
