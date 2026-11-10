(async()=>{
 const loaded=[...document.querySelectorAll('link[rel=stylesheet]')].find(e=>e.href.includes('detail-refinement.css'));
 if(!loaded)throw Error('Migration stylesheet missing');
 const settle=async()=>{await document.fonts.ready;await new Promise(r=>setTimeout(r,400));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))};
 const root=document.querySelector('.prototype-product');
 const contents=()=>({text:root.textContent.replace(/\s+/g,' ').trim(),values:[...root.querySelectorAll('input,textarea,select')].map(e=>[e.getAttribute('aria-label'),e.value,e.disabled,e.readOnly]),icons:[...root.querySelectorAll('svg')].map(e=>e.innerHTML),structure:[...root.querySelectorAll('*')].map(e=>[e.tagName,e.className.baseVal??e.className]),shadows:[...root.querySelectorAll('*')].map(e=>getComputedStyle(e).boxShadow)});
 loaded.disabled=true;await settle();const before=contents();
 loaded.disabled=false;await settle();const after=contents();
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Content, inputs, classes, icons, structure or shadows changed');
 if(document.documentElement.scrollWidth>innerWidth)throw Error('Document overflow');
 const stateCells=[...root.querySelectorAll('[data-narration-tone]')];
 const colors=stateCells.map(e=>({label:e.textContent,tone:e.dataset.narrationTone,color:getComputedStyle(e).color}));
 if(colors.length&&new Set(colors.map(c=>c.color)).size<4)throw Error('State colors not separated');
 const labels=[...root.querySelectorAll('.account-blueprint-form label:has(>textarea)')];
 const fields=labels.map(el=>{const r=el.getBoundingClientRect(),input=el.querySelector('textarea').getBoundingClientRect();return {label:el.querySelector('.field-label')?.textContent,inputLeft:input.left,width:input.width,columns:getComputedStyle(el).gridTemplateColumns,noOverflow:input.right<=r.right+1}});
 if(fields.some(f=>!f.noOverflow))throw Error('Rule field overflow');
 if(innerWidth>640&&fields.length&&new Set(fields.map(f=>f.inputLeft)).size!==1)throw Error('Rule inputs not aligned');
 if(window.__demoRequests.length)throw Error('Business request attempted');
 return {viewport:innerWidth,page:window.__demoState.page,theme:document.documentElement.dataset.theme,contentValuesStructureIconsShadowsPreserved:true,noPageOverflow:true,colors,fields,businessRequests:window.__demoRequests};
})()
