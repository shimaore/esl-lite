export class Headers {
  public contentLength: number | undefined
  public contentType: string | undefined
  public replyText: string | undefined
  public eventName: string | undefined
  public socketMode: string | undefined
  public control: string | undefined
  public jobUUID: string | undefined
  public applicationUUID: string | undefined
  private readonly headers = new Map<string, string>()

  has(name: string): boolean {
    return this.headers.has(name)
  }

  get(name: string): string | undefined {
    return this.headers.get(name)
  }

  set(name: string, value: string): void {
    this.headers.set(name, value)

    if (name === 'Content-Length' && value.match(/^\d+$/) != null) {
      this.contentLength = parseInt(value, 10)
      return
    }
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
