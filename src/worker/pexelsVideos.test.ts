// @vitest-environment node
import {expect,it} from 'vitest';
import {queryPexelsVideos} from './pexelsVideos';

it('search exposes safe optional thumbnails while retaining downloadable results without a usable image',async()=>{
 const results=await queryPexelsVideos({apiKey:'synthetic-key',query:'ocean',parameters:{orientation:'landscape',size:'medium',page:1},fetcher:async()=>Response.json({videos:[
  {id:11,image:'https://images.pexels.com/videos/11/free-photo.jpg'},
  {id:22},
  {id:33,image:'http://127.0.0.1/private.jpg'},
  {id:44,image:'https://images.pexels.com.evil.test/private.jpg'},
 ].map(v=>({...v,duration:4,url:`https://www.pexels.com/video/${v.id}/`,user:{name:'Fixture creator',url:'https://www.pexels.com/@fixture/'},video_files:[{id:v.id+1,file_type:'video/mp4',width:640,height:360,link:`https://videos.pexels.com/video-files/${v.id}/test.mp4`}]}))})});
 expect(results).toHaveLength(4);expect(results[0]).toHaveProperty('thumbnailUrl','https://images.pexels.com/videos/11/free-photo.jpg');
 expect(results.slice(1).every(result=>!('thumbnailUrl' in result))).toBe(true);
 expect(results.map(result=>result.id)).toEqual([11,22,33,44]);
});
