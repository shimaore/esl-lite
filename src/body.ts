import { type JSONValue } from './json-value.js'

/** Common body fields */
const eventName = 'Event-Name'
const applicationUUID = 'Application-UUID'
const jobUUID = 'Job-UUID'
const uniqueID = 'Unique-ID'

/** `_body` is returned in `BACKGROUND_JOB`. */
const body = '_body'

/** Internal field name, used to report errors */
const response = 'response'

/**
 * Storage for an event's body.
 *
 * Some specialized fields are automatically captured.
 */
export class Body {
  /**
   * Record a body at once and parse specific field
   */
  constructor(public readonly data: Record<string, JSONValue>) {
    if (response in data) {
      const value = data[response]
      this.response = value
    }
    if (body in data) {
      const value = data[body]
      this.response = value
    }

    if (eventName in data) {
      const value = data[eventName]
      if (typeof value === 'string') {
        this.eventName = value
      }
    }
    if (applicationUUID in data) {
      const value = data[applicationUUID]
      if (typeof value === 'string') {
        this.applicationUUID = value
      }
    }
    if (jobUUID in data) {
      const value = data[jobUUID]
      if (typeof value === 'string') {
        this.jobUUID = value
      }
    }
    if (uniqueID in data) {
      const value = data[uniqueID]
      if (typeof value === 'string') {
        this.uniqueID = value
      }
    }
  }

  /**
   * `Event-Name` field, if present
   */
  public eventName: string | undefined
  /**
   * `Application-UUID` field, if present
   */
  public applicationUUID: string | undefined
  /**
   * `Job-UUID` field, if present
   */
  public jobUUID: string | undefined
  /**
   * `Unique-ID` field, if present
   */
  public uniqueID: string | undefined

  /**
   * If present, indicates that the value returned by FreeSwitch was not an object.
   * Most probably, this is the content of the raw buffer received, converted to a string.
   */
  public response: JSONValue | undefined

  /**
   * Record a single body field and parse it
   */
  set(name: string, value: string): void {
    this.data[name] = value

    if (name === response) {
      this.response = value
      return
    }
    if (name === body) {
      this.response = value
      return
    }

    if (name === eventName) {
      this.eventName = value
      return
    }
    if (name === applicationUUID) {
      this.applicationUUID = value
      return
    }
    if (name === jobUUID) {
      this.jobUUID = value
    }
    if (name === uniqueID) {
      this.uniqueID = value
    }
  }
}
