import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
const prisma=new PrismaClient();
const categories=[
{name:'Fiction',slug:'fiction',description:'Stories that stay with you.'},{name:'Fantasy',slug:'fantasy',description:'Worlds beyond the ordinary.'},{name:'Personal Growth',slug:'personal-growth',description:'Small shifts, lasting change.'},{name:'Mystery',slug:'mystery',description:'Follow the clues.'},{name:'Technology',slug:'technology',description:'Ideas shaping tomorrow.'},{name:'Classics',slug:'classics',description:'Timeless voices and stories.'},{name:'Science Fiction',slug:'science-fiction',description:'Futures worth imagining.'},{name:'Non-fiction',slug:'non-fiction',description:'Ideas, science and the real world.'},{name:'Biography',slug:'biography',description:'Real lives, told well.'}
];
const books=[
['The Midnight Library','Matt Haig','9780525559474','Between life and death there is a library, and within that library, the shelves go on forever.',399,4.7,12,'fiction',2020,'https://covers.openlibrary.org/b/isbn/9780525559474-L.jpg'],
['Atomic Habits','James Clear','9780735211292','A practical guide to building good habits and breaking bad ones through small, consistent changes.',499,4.8,18,'personal-growth',2018,'https://covers.openlibrary.org/b/isbn/9780735211292-L.jpg'],
['The Silent Patient','Alex Michaelides','9781250301697','Alicia Berenson is a famous painter who shoots her husband and then never speaks again.',349,4.5,8,'mystery',2019,'https://covers.openlibrary.org/b/isbn/9781250301697-L.jpg'],
['The Hobbit','J. R. R. Tolkien','9780547928227','A reluctant hobbit joins a company of dwarves on an unexpected journey.',449,4.8,7,'fantasy',1937,'https://covers.openlibrary.org/b/isbn/9780547928227-L.jpg'],
['Ikigai','Héctor García and Francesc Miralles','9780143130727','A thoughtful exploration of the Japanese concept of a reason to get up in the morning.',299,4.4,15,'personal-growth',2016,'https://covers.openlibrary.org/b/isbn/9780143130727-L.jpg'],
['Pride and Prejudice','Jane Austen','9780141439518','Elizabeth Bennet navigates manners, marriage and first impressions in this enduring classic.',249,4.6,9,'classics',1813,'https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg'],
['The Alchemist','Paulo Coelho','9780061122415','A young shepherd follows a recurring dream in search of treasure and purpose.',299,4.5,13,'fiction',1988,'https://covers.openlibrary.org/b/isbn/9780061122415-L.jpg'],
['Clean Code','Robert C. Martin','9780132350884','A handbook of agile software craftsmanship focused on writing readable, maintainable code.',699,4.6,6,'technology',2008,'https://covers.openlibrary.org/b/isbn/9780132350884-L.jpg'],
['Dune','Frank Herbert','9780441172719','Political intrigue and ecological struggle unfold on the desert planet Arrakis.',599,4.7,5,'fantasy',1965,'https://covers.openlibrary.org/b/isbn/9780441172719-L.jpg'],
['Deep Work','Cal Newport','9781455586691','Rules for focused success in a distracted world.',399,4.5,11,'personal-growth',2016,'https://covers.openlibrary.org/b/isbn/9781455586691-L.jpg'],
['And Then There Were None','Agatha Christie','9780062073488','Ten strangers arrive on an island, where a mysterious host begins to reveal their secrets.',329,4.6,4,'mystery',1939,'https://covers.openlibrary.org/b/isbn/9780062073488-L.jpg'],
['The Little Prince','Antoine de Saint-Exupéry','9780156012195','A pilot meets a young prince whose travels reveal gentle truths about love and loss.',279,4.7,10,'classics',1943,'https://covers.openlibrary.org/b/isbn/9780156012195-L.jpg']
] as const;
const catMap:Record<string,string>={C:'classics',F:'fiction',S:'science-fiction',Y:'fantasy',M:'mystery',N:'non-fiction',B:'biography',P:'personal-growth',T:'technology'};
const extra=readFileSync(new URL('./extra-books.txt',import.meta.url),'utf8').trim().split('\n').map((l,i)=>{const[title,author,isbn,c,y,description]=l.split('|');return{title,author,isbn,description,cat:catMap[c],year:Number(y),price:199+((i*37)%400),rating:Number((4+((i*7)%10)/10).toFixed(1)),stock:4+((i*5)%13)}});
const cover=(isbn:string)=>`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
async function main(){
 for(const c of categories) await prisma.category.upsert({where:{slug:c.slug},update:{name:c.name,description:c.description},create:c});
 for(const b of books){const c=await prisma.category.findUniqueOrThrow({where:{slug:b[7]}});await prisma.book.upsert({where:{isbn:b[2]},update:{},create:{title:b[0],author:b[1],isbn:b[2],description:b[3],price:b[4],rating:b[5],stock:b[6],categoryId:c.id,publishedYear:b[8],coverUrl:b[9]}});}
 for(const b of extra){const c=await prisma.category.findUniqueOrThrow({where:{slug:b.cat}});await prisma.book.upsert({where:{isbn:b.isbn},update:{},create:{title:b.title,author:b.author,isbn:b.isbn,description:b.description,price:b.price,rating:b.rating,stock:b.stock,categoryId:c.id,publishedYear:b.year,coverUrl:cover(b.isbn)}});}
 const hash=await bcrypt.hash(process.env.SEED_PASSWORD||'Book@123',12);
 for(const [o,n] of [['customer','customer'],['librarian','librarian'],['staff','staff'],['admin','admin'],['auditor','auditor']]) await prisma.user.updateMany({where:{email:`${o}@bookhaven.demo`},data:{email:`${n}@bh.com`,passwordHash:hash}});
 for(const u of [{email:'customer@bh.com',name:'Aarav Mehta',role:Role.CUSTOMER},{email:'librarian@bh.com',name:'Mira Shah',role:Role.LIBRARIAN},{email:'staff@bh.com',name:'Rohan Das',role:Role.STAFF},{email:'admin@bh.com',name:'BookHaven Admin',role:Role.ADMIN},{email:'auditor@bh.com',name:'Read-only Auditor',role:Role.AUDITOR}]) await prisma.user.upsert({where:{email:u.email},update:{},create:{...u,passwordHash:hash}});
 console.log(`Ready: ${await prisma.book.count()} books in the shop.`);
}
main().finally(()=>prisma.$disconnect());
