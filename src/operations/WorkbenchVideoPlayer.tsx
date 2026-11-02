import {VideoPreview,type VideoPreviewProps} from '../ui/media/VideoPreview';

/** Compatibility entry for workbench artwork; host controls live in ui/media. */
export function WorkbenchVideoPlayer({source,...props}:Omit<VideoPreviewProps,'src'> & {source:string}){
 return <VideoPreview {...props} src={source} className="work-video-player"/>;
}
