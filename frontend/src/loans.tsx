import{useState}from'react';import{useMutation,useQuery,useQueryClient}from'@tanstack/react-query';import{CheckCircle2,Clock3,BookMarked,AlertTriangle,Undo2,Search}from'lucide-react';import{api,type User}from'./lib/api';import{money,toast}from'./lib/ui';
const DAY=86400000,FINE_PER_DAY=5;
const fmt=(d:string|Date)=>new Date(d).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
const plural=(n:number,w:string)=>`${n} ${w}${n===1?'':'s'}`;
export type LoanState='overdue'|'soon'|'ok'|'ontime'|'late';
/** Derives the display state of a loan: when it was borrowed, when it is due and what the return status is. */
export function loanInfo(l:any){
  const due=new Date(l.dueAt).getTime(),issued=new Date(l.issuedAt).getTime();
  if(l.status==='RETURNED'){
    const ret=new Date(l.returnedAt||l.dueAt).getTime(),late=Math.max(0,Math.floor((ret-due)/DAY));
    return{state:(late>0?'late':'ontime') as LoanState,label:late>0?'Returned late':'Returned on time',note:`Returned ${fmt(l.returnedAt||l.dueAt)}${late>0?` · ${plural(late,'day')} late`:''}`,progress:100,fine:Number(l.fineAmount)};
  }
  const now=Date.now(),left=Math.ceil((due-now)/DAY),progress=Math.min(100,Math.max(0,((now-issued)/Math.max(1,due-issued))*100));
  if(due<now){const od=Math.max(1,Math.floor((now-due)/DAY));return{state:'overdue' as LoanState,label:'Overdue',note:`${plural(od,'day')} overdue`,progress:100,fine:od*FINE_PER_DAY}}
  if(left<=3)return{state:'soon' as LoanState,label:'Due soon',note:left<=0?'Due today':`Return in ${plural(left,'day')}`,progress,fine:0};
  return{state:'ok' as LoanState,label:'On loan',note:`Return in ${plural(left,'day')}`,progress,fine:0};
}
function useLoans(user:User|null){return useQuery({queryKey:['loans'],queryFn:async()=>(await api.get('/loans')).data as any[],enabled:!!user})}
function Pill({s,label}:{s:LoanState;label:string}){return <span className={`lb-pill lb-${s}`}><i/>{label}</span>}
function Stat({icon:Icon,label,value,tone}:{icon:any;label:string;value:string|number;tone?:string}){return <div className={`lb-stat ${tone||''}`}><span><Icon size={17}/></span><div><strong>{value}</strong><small>{label}</small></div></div>}

/** Full loan dashboard: stats, filters and a status table. Used for customers (own loans) and staff/admin/auditor (all loans). */
export function LoanBoard({user,canReturn}:{user:User;canReturn:boolean}){
  const all=user.role!=='CUSTOMER',qc=useQueryClient(),{data:loans=[],isLoading}=useLoans(user);
  const[filter,setFilter]=useState<'all'|'active'|'overdue'|'returned'>('all'),[q,setQ]=useState('');
  const ret=useMutation({mutationFn:(id:string)=>api.post(`/loans/${id}/return`),onSuccess:d=>{toast(`Book returned. Fine: ${money(d.data.fineAmount)}`);qc.invalidateQueries({queryKey:['loans']});qc.invalidateQueries({queryKey:['summary']});qc.invalidateQueries({queryKey:['books']})},onError:(e:any)=>toast(e.response?.data?.error||'Could not process return')});
  const rows=loans.map(l=>({l,i:loanInfo(l)}));
  const c={active:rows.filter(r=>r.l.status==='ACTIVE').length,overdue:rows.filter(r=>r.i.state==='overdue').length,soon:rows.filter(r=>r.i.state==='soon').length,returned:rows.filter(r=>r.l.status==='RETURNED').length};
  const fines=rows.reduce((s,r)=>s+(r.l.status==='RETURNED'?r.i.fine:0),0),pending=rows.reduce((s,r)=>s+(r.i.state==='overdue'?r.i.fine:0),0);
  const term=q.trim().toLowerCase();
  const shown=rows.filter(({l,i})=>(filter==='all'||(filter==='active'&&l.status==='ACTIVE')||(filter==='overdue'&&i.state==='overdue')||(filter==='returned'&&l.status==='RETURNED'))&&(!term||`${l.book.title} ${l.book.author} ${l.user?.name||''} ${l.user?.email||''}`.toLowerCase().includes(term)));
  const chips:[typeof filter,string,number][]=[['all','All',rows.length],['active','Out now',c.active],['overdue','Overdue',c.overdue],['returned','Returned',c.returned]];
  return <div className="lb">
    <div className="lb-stats"><Stat icon={BookMarked} label="Currently borrowed" value={c.active}/><Stat icon={Clock3} label="Due within 3 days" value={c.soon} tone={c.soon?'lb-warn':''}/><Stat icon={AlertTriangle} label="Overdue" value={c.overdue} tone={c.overdue?'lb-bad':''}/><Stat icon={CheckCircle2} label="Returned" value={c.returned}/><Stat icon={Undo2} label={pending?'Fines accruing':'Fines collected'} value={money(pending||fines)} tone={pending?'lb-bad':''}/></div>
    <div className="lb-toolbar"><div className="lb-chips">{chips.map(([id,label,n])=><button key={id} className={filter===id?'active':''} onClick={()=>setFilter(id)}>{label}<b>{n}</b></button>)}</div>{all&&<label className="lb-search"><Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search book or borrower"/></label>}</div>
    {isLoading?<p className="lb-empty">Loading loan records…</p>:!shown.length?<p className="lb-empty">{rows.length?'No loans match this filter.':'No borrowing records yet.'}</p>:
    <div className="table-wrap"><table className="lb-table"><thead><tr><th>Book</th>{all&&<th>Borrower</th>}<th>Borrowed on</th><th>Due date</th><th>Return status</th><th>Fine</th>{canReturn&&<th/>}</tr></thead><tbody>
      {shown.map(({l,i})=><tr key={l.id}><td><strong>{l.book.title}</strong><small>{l.book.author}</small></td>{all&&<td>{l.user?.name}<small>{l.user?.email}</small></td>}<td>{fmt(l.issuedAt)}</td><td>{fmt(l.dueAt)}</td>
        <td><Pill s={i.state} label={i.label}/><small>{i.note}</small><div className={`lb-bar lb-${i.state}`}><span style={{width:`${i.progress}%`}}/></div></td>
        <td className={i.state==='overdue'||i.state==='late'?'lb-fine':''}>{l.status==='RETURNED'?money(i.fine):i.fine?`${money(i.fine)} so far`:'—'}</td>
        {canReturn&&<td>{l.status==='ACTIVE'&&<button className="small-action" disabled={ret.isPending} onClick={()=>ret.mutate(l.id)}>Mark returned</button>}</td>}</tr>)}
    </tbody></table></div>}
  </div>}

/** Compact "needs attention" list for the staff overview: overdue first, then due soonest. */
export function LoanWatch({user}:{user:User}){
  const{data:loans=[]}=useLoans(user);
  const list=loans.filter(l=>l.status==='ACTIVE').map(l=>({l,i:loanInfo(l)})).sort((a,b)=>new Date(a.l.dueAt).getTime()-new Date(b.l.dueAt).getTime()).slice(0,6);
  return <div className="dashboard-panel"><span className="eyebrow">NEEDS ATTENTION</span><h3>Books to chase</h3>{!list.length?<p className="muted">Nothing is out on loan right now.</p>:<ul className="lb-watch">{list.map(({l,i})=><li key={l.id}><div><strong>{l.book.title}</strong><small>{l.user?.name} · due {fmt(l.dueAt)}</small></div><Pill s={i.state} label={i.note}/></li>)}</ul>}</div>}
