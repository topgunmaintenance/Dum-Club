declare module "amazon-ivs-web-broadcast" {
  export class LocalStageStream {
    constructor(track: MediaStreamTrack, config?: any);
    mediaStreamTrack: MediaStreamTrack;
  }

  export interface StageStrategy {
    stageStreamsToPublish: () => LocalStageStream[];
    shouldPublishParticipant: (participant?: any) => boolean;
    shouldSubscribeToParticipant: (participant?: any) => SubscribeType;
  }

  export class Stage {
    constructor(token: string, strategy: StageStrategy);
    join(): Promise<void>;
    leave(): void;
    on(event: string, callback: (...args: any[]) => void): void;
  }

  export enum StageEvents {
    STAGE_CONNECTION_STATE_CHANGED = "stageConnectionStateChanged",
    STAGE_PARTICIPANT_JOINED = "stageParticipantJoined",
    STAGE_PARTICIPANT_LEFT = "stageParticipantLeft",
    STAGE_PARTICIPANT_STREAMS_ADDED = "stageParticipantStreamsAdded",
    STAGE_PARTICIPANT_STREAMS_REMOVED = "stageParticipantStreamsRemoved",
  }

  export enum ConnectionState {
    CLOSED = "closed",
    COMPLETED = "completed",
    CONNECTED = "connected",
    CONNECTING = "connecting",
    DISCONNECTED = "disconnected",
  }

  export enum SubscribeType {
    NONE = "none",
    AUDIO_ONLY = "audio_only",
    AUDIO_VIDEO = "audio_video",
  }
}
