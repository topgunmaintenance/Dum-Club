declare module "amazon-ivs-web-broadcast" {
  interface LocalStageStream {
    new (track: MediaStreamTrack): LocalStageStream;
    mediaStreamTrack: MediaStreamTrack;
  }

  interface StageStrategy {
    stageStreamsToPublish: () => LocalStageStream[];
    shouldPublishParticipant: (participant?: any) => boolean;
    shouldSubscribeToParticipant: (participant?: any) => any;
  }

  interface Stage {
    new (token: string, strategy: StageStrategy): Stage;
    join(): Promise<void>;
    leave(): void;
    on(event: string, callback: (...args: any[]) => void): void;
  }

  const StageEvents: {
    STAGE_CONNECTION_STATE_CHANGED: string;
    STAGE_PARTICIPANT_JOINED: string;
    STAGE_PARTICIPANT_LEFT: string;
    STAGE_PARTICIPANT_STREAMS_ADDED: string;
    STAGE_PARTICIPANT_STREAMS_REMOVED: string;
  };

  const ConnectionState: {
    CONNECTED: string;
    CONNECTING: string;
    DISCONNECTED: string;
  };

  const SubscribeType: {
    NONE: string;
    AUDIO_ONLY: string;
    AUDIO_VIDEO: string;
  };

  const _default: {
    Stage: Stage;
    LocalStageStream: LocalStageStream;
    StageEvents: typeof StageEvents;
    ConnectionState: typeof ConnectionState;
    SubscribeType: typeof SubscribeType;
  };

  export default _default;
}
