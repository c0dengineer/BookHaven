export const money=(v:string|number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(v));
export function toast(message:string,ms=3500){const host=document.getElementById('toast-host');if(!host)return;const el=document.createElement('div');el.className='toast';el.textContent=message;host.appendChild(el);setTimeout(()=>el.remove(),ms)}
