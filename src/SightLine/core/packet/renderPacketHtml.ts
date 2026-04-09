import type { BatchPacketItem } from "../../hooks/useTeacherLibrary";

export interface PacketMeta {
  packetId: string | null;
  title: string;
  className: string;
  notes: string;
  generatedAt: string;
  generatedAtIso: string;
}

export interface PacketSolfegeOptions {
  transformMusicXml?: (musicXml: string) => string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const toBase64Unicode = (value: string): string => btoa(unescape(encodeURIComponent(value)));

export function buildPacketHtml(
  items: BatchPacketItem[],
  meta: PacketMeta,
  options?: { autoExportZip?: boolean },
  solfegeOptions?: PacketSolfegeOptions,
): string {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const coverContents = sorted
    .map((item, i) => `<li>${i + 1}. ${escapeHtml(item.title)} (Seed ${item.seed})</li>`)
    .join("");
  const packetPages = sorted
    .map((item) => {
      const xmlForRender = solfegeOptions?.transformMusicXml
        ? solfegeOptions.transformMusicXml(item.musicXml)
        : item.musicXml;
      return `<section class="packet-page"><h1>${escapeHtml(item.title)}</h1><div class="packet-score" data-xml="${toBase64Unicode(xmlForRender)}" data-exercise-id="${escapeHtml(item.exerciseId)}" data-title="${escapeHtml(item.title)}" data-seed="${item.seed}"></div></section>`;
    })
    .join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>SightLine Packet</title>
<style>
  body{margin:0;font-family:"Avenir Next","Segoe UI",sans-serif;background:#fff;color:#111}
  .packet-toolbar{position:sticky;top:0;z-index:20;display:flex;justify-content:flex-end;padding:.75rem 1rem;border-bottom:1px solid #d0d7e2;background:#fff}
  .packet-toolbar button{border:1px solid #7c8fa8;background:#f6f9ff;color:#1f2f44;border-radius:8px;height:2.2rem;padding:0 .9rem;cursor:pointer;font-size:.92rem}
  .packet-list{padding:.75rem .75rem 1rem}
  .packet-cover{margin:0 0 .9rem;padding:.8rem .75rem;display:flex;flex-direction:column;gap:.55rem;page-break-after:always;break-after:page}
  .packet-cover h1{margin:0;text-align:center;font-size:1.4rem}
  .packet-cover h2{margin:0;text-align:center;font-size:1.05rem;font-weight:600}
  .packet-cover p,.packet-cover ul{margin:.35rem 0 0;padding-left:1.1rem}
  .packet-page{margin:0 0 .9rem;padding:.65rem .75rem .55rem;display:flex;flex-direction:column;gap:.55rem;break-inside:avoid;page-break-inside:avoid}
  .packet-page h1{margin:0;text-align:center;font-size:1.12rem}
  .packet-score{min-height:180px}.packet-score svg{display:block;margin:0 auto;max-width:100%;height:auto}
  @media print{.packet-toolbar{display:none}@page{margin:.45in}.packet-list{padding:0}}
</style>
<script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@1.9.2/build/opensheetmusicdisplay.min.js"></script>
</head><body>
<div class="packet-toolbar">
  <button id="printBtn" type="button">Print / Save as PDF</button>
  <button id="zipBtn" type="button">Export MusicXML ZIP</button>
</div>
<div class="packet-list" data-packet-id="${escapeHtml(meta.packetId ?? "")}" data-packet-title="${escapeHtml(meta.title)}" data-class-name="${escapeHtml(meta.className)}" data-created-at="${escapeHtml(meta.generatedAtIso)}">
  <section class="packet-cover">
    <h1>${escapeHtml(meta.title)}</h1>
    <h2>${escapeHtml(meta.className)}</h2>
    <p><strong>Date:</strong> ${escapeHtml(meta.generatedAt)}</p>
    ${meta.notes ? `<p><strong>Notes:</strong> ${escapeHtml(meta.notes)}</p>` : ""}
    <p><strong>Packet contents</strong></p>
    <ul>${coverContents}</ul>
  </section>
  ${packetPages}
</div>
<script>
const AUTO_EXPORT_ZIP=${options?.autoExportZip ? "true" : "false"};
const dec=v=>decodeURIComponent(escape(atob(v)));
const san=v=>String(v||"").normalize("NFKD").replace(/[^\w\\s-]/g,"").trim().replace(/\\s+/g,"_").slice(0,70)||"exercise";
const dtk=iso=>{const d=new Date(iso||Date.now());return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const COLORS={DO:"#ff3b30",DI:"#ff3b30",RE:"#ff9500",RI:"#ff9500",RA:"#ff9500",MI:"#ffd60a",ME:"#ffd60a",FA:"#32d74b",FI:"#32d74b",SOL:"#00c7be",SO:"#00c7be",SI:"#00c7be",SE:"#00c7be",LA:"#bf5af2",LE:"#bf5af2",LI:"#bf5af2",TI:"#ff2d95",TE:"#ff2d95"};
const applyColors=root=>{root.querySelectorAll("svg text").forEach(n=>{const c=COLORS[(n.textContent||"").trim().toUpperCase()];if(c){n.setAttribute("fill",c);n.style.fill=c;n.style.fontWeight="700"}})};
const exportZip=async()=>{
  const list=document.querySelector(".packet-list");
  const zip=new window.JSZip();const manifest=[];
  document.querySelectorAll(".packet-score").forEach((node,i)=>{
    const idx=String(i+1).padStart(3,"0"),title=node.dataset.title||("Exercise "+(i+1)),seed=Number(node.dataset.seed||0),eid=node.dataset.exerciseId||null,xml=dec(node.dataset.xml||""),fn=idx+"_"+san(title)+".musicxml";
    zip.file(fn,xml);manifest.push({id:eid,title,seed,filename:fn});
  });
  zip.file("packet_manifest.json",JSON.stringify({packet_id:list?.dataset.packetId||null,title:list?.dataset.packetTitle,class_name:list?.dataset.className,created_at:list?.dataset.createdAt,exercises:manifest},null,2));
  const blob=await zip.generateAsync({type:"blob"});
  const fn=san(list?.dataset.packetTitle||"packet")+"-"+dtk(list?.dataset.createdAt)+".zip";
  const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=fn;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
};
const renderAll=async()=>{
  for(const node of document.querySelectorAll(".packet-score")){
    const osmd=new opensheetmusicdisplay.OpenSheetMusicDisplay(node,{drawingParameters:"default",autoResize:false,backend:"svg"});
    await osmd.load(dec(node.dataset.xml||""));
    if(osmd.EngravingRules){const r=osmd.EngravingRules;r.RenderTitle=r.RenderSubtitle=r.RenderComposer=r.RenderLyricist=r.RenderPartNames=r.RenderPartAbbreviations=false;}
    osmd.Zoom=1.05;osmd.render();applyColors(node);
  }
};
document.getElementById("printBtn")?.addEventListener("click",()=>window.print());
document.getElementById("zipBtn")?.addEventListener("click",()=>exportZip().catch(console.error));
renderAll().then(()=>{if(AUTO_EXPORT_ZIP)exportZip().catch(console.error)});
</script></body></html>`;
}
