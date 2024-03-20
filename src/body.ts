import { type JSONValue } from './json-value.js'

const eventName = 'Event-Name'
const applicationUUID = 'Application-UUID'
const jobUUID = 'Job-UUID'
const uniqueID = 'Unique-ID'
const response = 'response'

export class Body {
  constructor(public readonly data: Record<string, JSONValue>) {
    if (response in data) {
      const value = data[response]
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

  public eventName: string | undefined
  public applicationUUID: string | undefined
  public jobUUID: string | undefined
  public uniqueID: string | undefined
  /* If present, indicates that the value returned by FreeSwitch was not an object. Most probably, this is the content of the raw buffer received, converted to string. */
  public response: JSONValue | undefined

  set(name: string, value: string): void {
    this.data[name] = value

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
