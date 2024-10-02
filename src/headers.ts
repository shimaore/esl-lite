/**
 * Storage for an event's headers.
 *
 * Some specialized headers are automatically captured.
 */
export class Headers {
  /**
   * `Content-Length` header, parsed
   */
  public contentLength: number | undefined
  /**
   * `Content-Type` header
   */
  public contentType: string | undefined
  /**
   * `Reply-Text` header
   */
  public replyText: string | undefined
  /**
   * `Event-Name` header
   */
  public eventName: string | undefined
  /**
   * `Socket-Mode` header
   */
  public socketMode: string | undefined
  /**
   * `Control` header
   */
  public control: string | undefined

  private readonly headers = new Map<string, string>()

  /**
   * Return true if the header is present
   */
  has(name: string): boolean {
    return this.headers.has(name)
  }

  /**
   * Return the value of the header, if present
   */
  get(name: string): string | undefined {
    return this.headers.get(name)
  }

  /**
   * Record a single header and parse it
   */
  set(name: string, value: string): void {
    this.headers.set(name, value)

    if (name === 'Content-Length' && /^\d+$/.exec(value) != null) {
      this.contentLength = parseInt(value, 10)
      return
    }
    // Typically `command/reply` will contain the status in the `Reply-Text` header while `api/response` will contain the status in the body.
    if (name === 'Reply-Text') {
      this.replyText = value
      return
    }
    if (name === 'Content-Type') {
      this.contentType = value
      return
    }
    if (name === 'Event-Name') {
      this.eventName = value
      return
    }
    if (name === 'Socket-Mode') {
      this.socketMode = value
      return
    }
    if (name === 'Control') {
      this.control = value
    }
  }
}
