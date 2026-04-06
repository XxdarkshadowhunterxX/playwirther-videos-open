import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
ffmpeg.setFfmpegPath(ffmpegStatic);

ffmpeg()
  .input('color=c=red:r=1:s=1080x1920:d=1')
  .inputOptions('-f', 'lavfi')
  .complexFilter([
    '[0:v]split=2[bg_src][fg_src]',
    '[bg_src]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:5,colorchannelmixer=rr=0.5:gg=0.5:bb=0.5[bg]',
    '[fg_src]scale=1080:1920:force_original_aspect_ratio=decrease[fg]',
    '[bg][fg]overlay=(W-w)/2:(H-h)/2[merged]',
    "[merged]zoompan=z='min(zoom+0.01,1.15)':d=24:x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':s=1080x1920[out]"
  ])
  .outputOptions([
    '-map', '[out]',
    '-t', '1',
    '-pix_fmt', 'yuv420p'
  ])
  .output('testFFMPEG.mp4')
  .on('error', console.error)
  .on('end', () => console.log('DONE'))
  .run();
