import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PrismaClient, Role, AuditAction, LoanStatus, OrderStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { calculateFine, getDueDate } from './lib/fines.js';

const app = express();
app.set('trust proxy', 1);
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-only-secret-change-me-32-characters');
if (JWT_SECRET.length < 32) { console.error('JWT_SECRET must be set to at least 32 characters'); process.exit(1); }
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: FRONTEND_ORIGIN.split(',').map(s => s.trim()), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

type AuthUser = { id: string; email: string; name: string; role: Role };
declare global { namespace Express { interface Request { user?: AuthUser } } }
const asyncHandler = (fn: (req: express.Request, res: express.Response, next: express.NextFunction) => Promise<unknown>) => (req: express.Request, res: express.Response, next: express.NextFunction) => Promise.resolve(fn(req,res,next)).catch(next);
async function audit(actorId: string | null, action: AuditAction, resource: string, resourceId?: string, details?: unknown, req?: express.Request) {
  await prisma.auditLog.create({ data: { actorId, action, resource, resourceId, details: details as never, ipAddress: req?.ip } });
}
const auth = asyncHandler(async (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: 'Authentication required' }); return; }
  try {
    {
      const claims = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
      const user = await prisma.user.findUnique({ where: { id: String(claims.sub) }, select: { id: true, email: true, name: true, role: true } });
      if (!user) { res.status(401).json({ error: 'Invalid session' }); return; }
      req.user = user;
    }
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
});
const allow = (...roles: Role[]) => (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!req.user || !roles.includes(req.user.role)) { void audit(req.user?.id ?? null, AuditAction.ACCESS_DENIED, req.path, undefined, { requiredRoles: roles }, req).catch(()=>{}); res.status(403).json({ error: 'You do not have permission to perform this action' }); return; }
  next();
};
const userRoles = [Role.CUSTOMER, Role.STAFF, Role.LIBRARIAN, Role.ADMIN, Role.AUDITOR];
app.get('/api/health', (_req,res) => res.json({ status: 'ok', service: 'BookHaven API', time: new Date().toISOString() }));

app.post('/api/auth/register', asyncHandler(async (req,res) => {
  const input = z.object({ name: z.string().trim().min(2).max(80), email: z.email(), password: z.string().min(8).max(100) }).parse(req.body);
  const email = input.email.toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({ data: { name: input.name, email, passwordHash, role: Role.CUSTOMER }, select: { id:true,email:true,name:true,role:true } });
  const token = jwt.sign({ sub:user.id }, JWT_SECRET, { expiresIn:'8h', issuer:'bookhaven' });
  await audit(user.id, AuditAction.CREATE, 'user', user.id, { registration: true }, req);
  res.status(201).json({ token, user });
}));
app.post('/api/auth/login', asyncHandler(async (req,res) => {
  const input = z.object({ email:z.email(), password:z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where:{ email:input.email.toLowerCase() } });
  if (!user?.passwordHash || !(await bcrypt.compare(input.password,user.passwordHash))) { res.status(401).json({ error:'Email or password is incorrect' }); return; }
  const token = jwt.sign({ sub:user.id }, JWT_SECRET, { expiresIn:'8h', issuer:'bookhaven' });
  await audit(user.id, AuditAction.LOGIN, 'user', user.id, {}, req);
  res.json({ token, user:{ id:user.id,email:user.email,name:user.name,role:user.role } });
}));
app.get('/api/auth/me', auth, (req,res) => res.json({ user:req.user }));
app.get('/api/categories', asyncHandler(async (_req,res) => res.json(await prisma.category.findMany({ orderBy:{name:'asc'}, include:{_count:{select:{books:true}}} }))));
app.get('/api/books', asyncHandler(async (req,res) => {
  const q = String(req.query.q || '').trim(); const category = String(req.query.category || '');
  const page = Math.max(1, Number(req.query.page) || 1); const limit = Math.min(48, Math.max(1, Number(req.query.limit) || 12));
  const sort = String(req.query.sort || 'featured');
  const where = { AND: [ ...(q ? [{ OR:[{title:{contains:q,mode:'insensitive' as const}},{author:{contains:q,mode:'insensitive' as const}},{isbn:{contains:q}},{category:{name:{contains:q,mode:'insensitive' as const}}}] }] : []), ...(category ? [{category:{slug:category}}] : []) ] };
  const orderBy = sort==='price-asc' ? {price:'asc' as const} : sort==='price-desc' ? {price:'desc' as const} : sort==='title' ? {title:'asc' as const} : {createdAt:'desc' as const};
  const [items,total] = await prisma.$transaction([prisma.book.findMany({where,orderBy,skip:(page-1)*limit,take:limit,include:{category:true}}),prisma.book.count({where})]);
  res.json({ items,total,page,limit,pages:Math.ceil(total/limit) });
}));
app.get('/api/books/:id', asyncHandler(async (req,res) => {
  const book = await prisma.book.findFirst({ where:{ OR:[{id:req.params.id},{isbn:req.params.id}] }, include:{category:true} });
  if (!book) { res.status(404).json({error:'Book not found'}); return; }
  const related = await prisma.book.findMany({where:{categoryId:book.categoryId,id:{not:book.id}},take:4,include:{category:true}});
  res.json({ ...book, related });
}));
const bookInput = z.object({title:z.string().min(1).max(200),author:z.string().min(1).max(120),isbn:z.string().min(5).max(20),description:z.string().min(1),coverUrl:z.string().url().optional().or(z.literal('')),price:z.coerce.number().min(0).max(100000),rating:z.coerce.number().min(0).max(5).optional(),stock:z.coerce.number().int().min(0).max(100000),publishedYear:z.coerce.number().int().min(1000).max(2100).optional(),categoryId:z.string().min(1)});
app.post('/api/books',auth,allow(Role.LIBRARIAN,Role.ADMIN),asyncHandler(async(req,res)=>{const data=bookInput.parse(req.body);const b=await prisma.book.create({data:{...data,...(data.coverUrl!==undefined?{coverUrl:data.coverUrl||null}:{})},include:{category:true}});await audit(req.user!.id,AuditAction.CREATE,'book',b.id,{},req);res.status(201).json(b);}));
app.patch('/api/books/:id',auth,allow(Role.LIBRARIAN,Role.ADMIN),asyncHandler(async(req,res)=>{const data=bookInput.partial().parse(req.body);const b=await prisma.book.update({where:{id:req.params.id},data:{...data,...(data.coverUrl!==undefined?{coverUrl:data.coverUrl||null}:{})},include:{category:true}});await audit(req.user!.id,AuditAction.UPDATE,'book',b.id,{},req);res.json(b);}));
app.delete('/api/books/:id',auth,allow(Role.ADMIN),asyncHandler(async(req,res)=>{const b=await prisma.book.delete({where:{id:req.params.id}});await audit(req.user!.id,AuditAction.DELETE,'book',b.id,{},req);res.json({ok:true});}));
app.post('/api/categories',auth,allow(Role.LIBRARIAN,Role.ADMIN),asyncHandler(async(req,res)=>{const d=z.object({name:z.string().min(2).max(80),slug:z.string().regex(/^[a-z0-9-]+$/),description:z.string().optional()}).parse(req.body);res.status(201).json(await prisma.category.create({data:d}));}));
app.patch('/api/categories/:id',auth,allow(Role.LIBRARIAN,Role.ADMIN),asyncHandler(async(req,res)=>{const d=z.object({name:z.string().min(2).max(80).optional(),slug:z.string().regex(/^[a-z0-9-]+$/).optional(),description:z.string().optional()}).parse(req.body);res.json(await prisma.category.update({where:{id:req.params.id},data:d}));}));
app.delete('/api/categories/:id',auth,allow(Role.ADMIN),asyncHandler(async(req,res)=>{await prisma.category.delete({where:{id:req.params.id}});res.json({ok:true});}));

app.get('/api/cart',auth,asyncHandler(async(req,res)=>{ const items=await prisma.cartItem.findMany({where:{userId:req.user!.id},include:{book:{include:{category:true}}}}); res.json(items); }));
app.post('/api/cart',auth,allow(Role.CUSTOMER),asyncHandler(async(req,res)=>{const d=z.object({bookId:z.string(),quantity:z.coerce.number().int().min(1).max(20).default(1)}).parse(req.body);const book=await prisma.book.findUnique({where:{id:d.bookId}});if(!book||book.stock<d.quantity){res.status(400).json({error:'Book unavailable or insufficient stock'});return;}const item=await prisma.cartItem.upsert({where:{userId_bookId:{userId:req.user!.id,bookId:d.bookId}},create:{userId:req.user!.id,bookId:d.bookId,quantity:d.quantity},update:{quantity:d.quantity}});res.status(201).json(item);}));
app.patch('/api/cart/:id',auth,allow(Role.CUSTOMER),asyncHandler(async(req,res)=>{const d=z.object({quantity:z.coerce.number().int().min(1).max(20)}).parse(req.body);const item=await prisma.cartItem.findFirst({where:{id:req.params.id,userId:req.user!.id},include:{book:true}});if(!item){res.status(404).json({error:'Cart item not found'});return;}if(d.quantity>item.book.stock){res.status(400).json({error:'Quantity exceeds available stock'});return;}res.json(await prisma.cartItem.update({where:{id:item.id},data:{quantity:d.quantity}}));}));
app.delete('/api/cart/:id',auth,asyncHandler(async(req,res)=>{const r=await prisma.cartItem.deleteMany({where:{id:req.params.id,userId:req.user!.id}});if(!r.count){res.status(404).json({error:'Cart item not found'});return;}res.json({ok:true});}));
app.post('/api/checkout',auth,allow(Role.CUSTOMER),asyncHandler(async(req,res)=>{
 const result=await prisma.$transaction(async tx=>{const cart=await tx.cartItem.findMany({where:{userId:req.user!.id},include:{book:true}});if(!cart.length)throw Object.assign(new Error('Your cart is empty'),{status:400});for(const item of cart){const updated=await tx.book.updateMany({where:{id:item.bookId,stock:{gte:item.quantity}},data:{stock:{decrement:item.quantity}}});if(!updated.count)throw Object.assign(new Error(`Insufficient stock for ${item.book.title}`),{status:409});}const total=cart.reduce((s,i)=>s+Number(i.book.price)*i.quantity,0);const order=await tx.order.create({data:{userId:req.user!.id,status:OrderStatus.PAID,total,simulatedPaymentRef:`DEMO-${Date.now()}`,items:{create:cart.map(i=>({bookId:i.bookId,titleSnapshot:i.book.title,unitPrice:i.book.price,quantity:i.quantity}))}},include:{items:true}});await tx.cartItem.deleteMany({where:{userId:req.user!.id}});return order;});await audit(req.user!.id,AuditAction.CHECKOUT,'order',result.id,{simulated:true,total:String(result.total)},req);res.status(201).json({order:result,payment:'SIMULATED — no real payment was processed'});
}));
app.get('/api/orders',auth,asyncHandler(async(req,res)=>{const userId=req.user!.role===Role.ADMIN&&req.query.all==='true'?undefined:req.user!.id;res.json(await prisma.order.findMany({where:userId?{userId}:undefined,include:{items:true,user:{select:{id:true,name:true,email:true}}},orderBy:{createdAt:'desc'},take:100}));}));
app.get('/api/wishlist',auth,asyncHandler(async(req,res)=>{ const items=await prisma.wishlistItem.findMany({where:{userId:req.user!.id},include:{book:{include:{category:true}}}}); res.json(items); }));
app.post('/api/wishlist/:bookId',auth,asyncHandler(async(req,res)=>{res.status(201).json(await prisma.wishlistItem.upsert({where:{userId_bookId:{userId:req.user!.id,bookId:req.params.bookId}},create:{userId:req.user!.id,bookId:req.params.bookId},update:{}}));}));
app.delete('/api/wishlist/:bookId',auth,asyncHandler(async(req,res)=>{await prisma.wishlistItem.deleteMany({where:{userId:req.user!.id,bookId:req.params.bookId}});res.json({ok:true});}));
app.patch('/api/profile',auth,asyncHandler(async(req,res)=>{const d=z.object({name:z.string().trim().min(2).max(80)}).parse(req.body);res.json(await prisma.user.update({where:{id:req.user!.id},data:d,select:{id:true,name:true,email:true,role:true}}));}));
app.get('/api/loans',auth,asyncHandler(async(req,res)=>{const where=req.user!.role===Role.CUSTOMER?{userId:req.user!.id}:{};res.json(await prisma.loan.findMany({where,include:{book:true,user:{select:{id:true,name:true,email:true}}},orderBy:{issuedAt:'desc'},take:200}));}));
app.post('/api/loans',auth,allow(Role.LIBRARIAN,Role.ADMIN,Role.STAFF),asyncHandler(async(req,res)=>{const d=z.object({userId:z.string(),bookId:z.string(),loanDays:z.coerce.number().int().min(1).max(365).default(14)}).parse(req.body);const loan=await prisma.$transaction(async tx=>{const b=await tx.book.findUnique({where:{id:d.bookId}});if(!b||b.stock<1)throw Object.assign(new Error('Book is unavailable'),{status:409});const stockUpdate=await tx.book.updateMany({where:{id:b.id,stock:{gte:1}},data:{stock:{decrement:1}}});if(!stockUpdate.count)throw Object.assign(new Error('Book is unavailable'),{status:409});const issuedAt=new Date();return tx.loan.create({data:{userId:d.userId,bookId:d.bookId,issuedById:req.user!.id,issuedAt,dueAt:getDueDate(issuedAt,d.loanDays)},include:{book:true,user:{select:{id:true,name:true,email:true}}}});});await audit(req.user!.id,AuditAction.LOAN_ISSUE,'loan',loan.id,{},req);res.status(201).json(loan);}));
app.post('/api/loans/:id/return',auth,allow(Role.LIBRARIAN,Role.ADMIN,Role.STAFF),asyncHandler(async(req,res)=>{const loan=await prisma.loan.findUnique({where:{id:req.params.id}});if(!loan){res.status(404).json({error:'Loan not found'});return;}if(loan.status===LoanStatus.RETURNED){res.status(409).json({error:'This loan has already been returned'});return;}const returnedAt=new Date();const fine=calculateFine(loan.dueAt,returnedAt);const updated=await prisma.$transaction(async tx=>{const r=await tx.loan.updateMany({where:{id:loan.id,status:LoanStatus.ACTIVE},data:{status:LoanStatus.RETURNED,returnedAt,fineAmount:fine}});if(!r.count)throw Object.assign(new Error('Loan was already returned'),{status:409});await tx.book.update({where:{id:loan.bookId},data:{stock:{increment:1}}});return tx.loan.findUnique({where:{id:loan.id},include:{book:true,user:{select:{id:true,name:true,email:true}}}});});await audit(req.user!.id,AuditAction.LOAN_RETURN, 'loan',loan.id,{fine},req);res.json(updated);}));
app.post('/api/newsletter',asyncHandler(async(req,res)=>{const d=z.object({email:z.email()}).parse(req.body);try{const sub=await prisma.newsletterSubscription.create({data:{email:d.email.toLowerCase()}});res.status(201).json({ok:true,id:sub.id});}catch(e){if((e as {code?:string}).code==='P2002'){res.json({ok:true,message:'Already subscribed'});return;}throw e;}}));
app.get('/api/dashboard/summary',auth,allow(Role.STAFF,Role.LIBRARIAN,Role.ADMIN,Role.AUDITOR),asyncHandler(async(req,res)=>{const [books,customers,activeLoans,overdueLoans,orders,revenue]=await Promise.all([prisma.book.count(),prisma.user.count({where:{role:Role.CUSTOMER}}),prisma.loan.count({where:{status:LoanStatus.ACTIVE}}),prisma.loan.count({where:{status:LoanStatus.ACTIVE,dueAt:{lt:new Date()}}}),prisma.order.count(),prisma.order.aggregate({where:{status:OrderStatus.PAID},_sum:{total:true}})]);res.json({books,customers,activeLoans,overdueLoans,orders,revenue:Number(revenue._sum.total||0),role:req.user!.role});}));
app.get('/api/admin/users',auth,allow(Role.ADMIN,Role.AUDITOR),asyncHandler(async(req,res)=>res.json(await prisma.user.findMany({select:{id:true,name:true,email:true,role:true,createdAt:true},orderBy:{createdAt:'desc'},take:500}))));
app.patch('/api/admin/users/:id/role',auth,allow(Role.ADMIN),asyncHandler(async(req,res)=>{const d=z.object({role:z.enum(['CUSTOMER','STAFF','LIBRARIAN','ADMIN','AUDITOR'])}).parse(req.body);if(req.params.id===req.user!.id&&d.role!==Role.ADMIN){res.status(400).json({error:'You cannot remove your own admin role'});return;}const user=await prisma.user.update({where:{id:req.params.id},data:{role:d.role},select:{id:true,name:true,email:true,role:true}});await audit(req.user!.id,AuditAction.UPDATE,'user',user.id,{role:d.role},req);res.json(user);}));
app.get('/api/customers',auth,allow(Role.ADMIN,Role.LIBRARIAN,Role.STAFF),asyncHandler(async(_req,res)=>res.json(await prisma.user.findMany({where:{role:Role.CUSTOMER},select:{id:true,name:true,email:true},orderBy:{name:'asc'}}))));
app.get('/api/audit-logs',auth,allow(Role.ADMIN,Role.AUDITOR),asyncHandler(async(req,res)=>res.json(await prisma.auditLog.findMany({include:{actor:{select:{name:true,email:true,role:true}}},orderBy:{createdAt:'desc'},take:200}))));
app.use((_req,res)=>res.status(404).json({error:'Endpoint not found'}));
app.use((err: unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if(err instanceof z.ZodError){res.status(400).json({error:'Validation failed',details:err.issues.map(i=>({path:i.path.join('.'),message:i.message}))});return;}const e=err as {status?:number;code?:string;message?:string};if(e.code==='P2002'){res.status(409).json({error:'A record with this value already exists'});return;}if(e.code==='P2025'){res.status(404).json({error:'Record not found'});return;}if(e.code==='P2003'){res.status(409).json({error:'This record is in use and cannot be removed'});return;}console.error('API error:',e.message||err);res.status(e.status||500).json({error:e.status&&e.status<500?e.message:'An unexpected server error occurred'});});
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => console.log(`BookHaven API listening on http://localhost:${PORT}`));
  async function shutdown() { server.close(); await prisma.$disconnect(); process.exit(0); }
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
export default app;
