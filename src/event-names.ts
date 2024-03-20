// List from https://github.com/signalwire/freeswitch/blob/master/src/switch_event.c#L137
export type EventName =
  | 'CUSTOM'
  | 'CLONE'
  | 'CHANNEL_CREATE'
  | 'CHANNEL_DESTROY'
  | 'CHANNEL_STATE'
  | 'CHANNEL_CALLSTATE'
  | 'CHANNEL_ANSWER'
  | 'CHANNEL_HANGUP'
  | 'CHANNEL_HANGUP_COMPLETE'
  | 'CHANNEL_EXECUTE'
  | 'CHANNEL_EXECUTE_COMPLETE'
  | 'CHANNEL_HOLD'
  | 'CHANNEL_UNHOLD'
  | 'CHANNEL_BRIDGE'
  | 'CHANNEL_UNBRIDGE'
  | 'CHANNEL_PROGRESS'
  | 'CHANNEL_PROGRESS_MEDIA'
  | 'CHANNEL_OUTGOING'
  | 'CHANNEL_PARK'
  | 'CHANNEL_UNPARK'
  | 'CHANNEL_APPLICATION'
  | 'CHANNEL_ORIGINATE'
  | 'CHANNEL_UUID'
  | 'API'
  | 'LOG'
  | 'INBOUND_CHAN'
  | 'OUTBOUND_CHAN'
  | 'STARTUP'
  | 'SHUTDOWN'
  | 'PUBLISH'
  | 'UNPUBLISH'
  | 'TALK'
  | 'NOTALK'
  | 'SESSION_CRASH'
  | 'MODULE_LOAD'
  | 'MODULE_UNLOAD'
  | 'DTMF'
  | 'MESSAGE'
  | 'PRESENCE_IN'
  | 'NOTIFY_IN'
  | 'PRESENCE_OUT'
  | 'PRESENCE_PROBE'
  | 'MESSAGE_WAITING'
  | 'MESSAGE_QUERY'
  | 'ROSTER'
  | 'CODEC'
  | 'BACKGROUND_JOB'
  | 'DETECTED_SPEECH'
  | 'DETECTED_TONE'
  | 'PRIVATE_COMMAND'
  | 'HEARTBEAT'
  | 'TRAP'
  | 'ADD_SCHEDULE'
  | 'DEL_SCHEDULE'
  | 'EXE_SCHEDULE'
  | 'RE_SCHEDULE'
  | 'RELOADXML'
  | 'NOTIFY'
  | 'PHONE_FEATURE'
  | 'PHONE_FEATURE_SUBSCRIBE'
  | 'SEND_MESSAGE'
  | 'RECV_MESSAGE'
  | 'REQUEST_PARAMS'
  | 'CHANNEL_DATA'
  | 'GENERAL'
  | 'COMMAND'
  | 'SESSION_HEARTBEAT'
  | 'CLIENT_DISCONNECTED'
  | 'SERVER_DISCONNECTED'
  | 'SEND_INFO'
  | 'RECV_INFO'
  | 'RECV_RTCP_MESSAGE'
  | 'SEND_RTCP_MESSAGE'
  | 'CALL_SECURE'
  | 'NAT'
  | 'RECORD_START'
  | 'RECORD_STOP'
  | 'PLAYBACK_START'
  | 'PLAYBACK_STOP'
  | 'CALL_UPDATE'
  | 'FAILURE'
  | 'SOCKET_DATA'
  | 'MEDIA_BUG_START'
  | 'MEDIA_BUG_STOP'
  | 'CONFERENCE_DATA_QUERY'
  | 'CONFERENCE_DATA'
  | 'CALL_SETUP_REQ'
  | 'CALL_SETUP_RESULT'
  | 'CALL_DETAIL'
  | 'DEVICE_STATE'
  | 'TEXT'
  | 'SHUTDOWN_REQUESTED'
  | 'ALL'

export const EventNames = new Set<EventName>([
  'CUSTOM',
  'CLONE',
  'CHANNEL_CREATE',
  'CHANNEL_DESTROY',
  'CHANNEL_STATE',
  'CHANNEL_CALLSTATE',
  'CHANNEL_ANSWER',
  'CHANNEL_HANGUP',
  'CHANNEL_HANGUP_COMPLETE',
  'CHANNEL_EXECUTE',
  'CHANNEL_EXECUTE_COMPLETE',
  'CHANNEL_HOLD',
  'CHANNEL_UNHOLD',
  'CHANNEL_BRIDGE',
  'CHANNEL_UNBRIDGE',
  'CHANNEL_PROGRESS',
  'CHANNEL_PROGRESS_MEDIA',
  'CHANNEL_OUTGOING',
  'CHANNEL_PARK',
  'CHANNEL_UNPARK',
  'CHANNEL_APPLICATION',
  'CHANNEL_ORIGINATE',
  'CHANNEL_UUID',
  'API',
  'LOG',
  'INBOUND_CHAN',
  'OUTBOUND_CHAN',
  'STARTUP',
  'SHUTDOWN',
  'PUBLISH',
  'UNPUBLISH',
  'TALK',
  'NOTALK',
  'SESSION_CRASH',
  'MODULE_LOAD',
  'MODULE_UNLOAD',
  'DTMF',
  'MESSAGE',
  'PRESENCE_IN',
  'NOTIFY_IN',
  'PRESENCE_OUT',
  'PRESENCE_PROBE',
  'MESSAGE_WAITING',
  'MESSAGE_QUERY',
  'ROSTER',
  'CODEC',
  'BACKGROUND_JOB',
  'DETECTED_SPEECH',
  'DETECTED_TONE',
  'PRIVATE_COMMAND',
  'HEARTBEAT',
  'TRAP',
  'ADD_SCHEDULE',
  'DEL_SCHEDULE',
  'EXE_SCHEDULE',
  'RE_SCHEDULE',
  'RELOADXML',
  'NOTIFY',
  'PHONE_FEATURE',
  'PHONE_FEATURE_SUBSCRIBE',
  'SEND_MESSAGE',
  'RECV_MESSAGE',
  'REQUEST_PARAMS',
  'CHANNEL_DATA',
  'GENERAL',
  'COMMAND',
  'SESSION_HEARTBEAT',
  'CLIENT_DISCONNECTED',
  'SERVER_DISCONNECTED',
  'SEND_INFO',
  'RECV_INFO',
  'RECV_RTCP_MESSAGE',
  'SEND_RTCP_MESSAGE',
  'CALL_SECURE',
  'NAT',
  'RECORD_START',
  'RECORD_STOP',
  'PLAYBACK_START',
  'PLAYBACK_STOP',
  'CALL_UPDATE',
  'FAILURE',
  'SOCKET_DATA',
  'MEDIA_BUG_START',
  'MEDIA_BUG_STOP',
  'CONFERENCE_DATA_QUERY',
  'CONFERENCE_DATA',
  'CALL_SETUP_REQ',
  'CALL_SETUP_RESULT',
  'CALL_DETAIL',
  'DEVICE_STATE',
  'TEXT',
  'SHUTDOWN_REQUESTED',
  'ALL',
])
export const isEventName = (v: string): v is EventName =>
  EventNames.has(v as EventName)
