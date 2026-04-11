declare module "@mux/mux-player-react" {
  import { ComponentType } from "react";

  interface MuxPlayerProps {
    playbackId?: string;
    streamType?: "live" | "on-demand";
    autoPlay?: boolean | "muted" | "any";
    muted?: boolean;
    loop?: boolean;
    style?: React.CSSProperties;
    className?: string;
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    placeholder?: string;
    [key: string]: unknown;
  }

  const MuxPlayer: ComponentType<MuxPlayerProps>;
  export default MuxPlayer;
}
