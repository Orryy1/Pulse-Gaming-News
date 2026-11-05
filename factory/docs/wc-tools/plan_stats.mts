// Per-episode measures from the render plan and script, from a COPY of the database. usage: node --import tsx plan_stats.mts <db copy> <out.json>
import { PGlite } from "@electric-sql/pglite";
import { writeFileSync } from "node:fs";
const db = new PGlite(process.argv[2]);
const rows:any[] = (await db.query(`SELECT id,lane,status,youtube_video_id vid,publish_at,script_json s,assets_json a,qa_json q,factcheck_json f FROM episodes WHERE status='published' AND created_at>now()-interval '30 days' ORDER BY created_at DESC`)).rows;
const out:any[]=[];
for(const r of rows){const p=r.a?.plan; const shots=p?.shots??[]; const tot=p?.totalFrames||shots.at(-1)?.end||1;
 const by:Record<string,number>={};const uniq=new Set<string>();let maxShot=0;
 for(const x of shots){const t=x.media?.type??'none';const d=x.end-x.start;by[t]=(by[t]||0)+d;uniq.add(t+':'+(x.media?.index??''));maxShot=Math.max(maxShot,d);}
 const s=r.s||{};const text=[s.hook,...(s.beats||[]).map((b:any)=>b.narration),s.pulse_take?.narration,s.loop_line].filter(Boolean).join(' ');
 const words=text.split(/\s+/).filter(Boolean);const you=(text.match(/\b(you|your|you're|you'll)\b/gi)||[]).length;
 const rub=Object.fromEntries((r.q?.rubric?.metrics||[]).map((m:any)=>[m.name,m.value]));
 out.push({id:r.id,lane:r.lane,fmt:s.evergreen_format||s.story_type,vid:r.vid,at:r.publish_at,dur:r.a?.durationSeconds,shots:shots.length,plate:+((by.plate||0)/tot).toFixed(2),clip:+((by.clip||0)/tot).toFixed(2),image:+((by.image||0)/tot).toFixed(2),other:Object.keys(by).filter(k=>!['plate','clip','image'].includes(k)),uniq:uniq.size,maxShotS:+(maxShot/30).toFixed(1),words:words.length,youPer100:+(100*you/Math.max(words.length,1)).toFixed(1),hookW:(s.hook||'').split(/\s+/).length,hook:s.hook,loop:s.loop_line,take:s.pulse_take?.label,rub:{wpm:rub.wpm,unique:rub.unique_media_ratio,rep:rub.max_media_repeat,fs:rub.footage_share,fsec:rub.footage_seconds},visionNotes:(r.q?.vision?.notes||'').slice(0,200),grade:r.q?.rubric?.grade});}
writeFileSync(process.argv[3],JSON.stringify(out,null,0));
await db.close();
