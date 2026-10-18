import axios from 'axios';
export const api=axios.create({baseURL:import.meta.env.VITE_API_URL||'http://localhost:4000/api',timeout:60000,headers:{'Content-Type':'application/json'}});
api.interceptors.request.use(config=>{const token=localStorage.getItem('bookhaven_token');if(token)config.headers.Authorization=`Bearer ${token}`;return config;});
export type Category={id:string;name:string;slug:string;description?:string;_count?:{books:number}};
export type Book={id:string;title:string;author:string;isbn:string;description:string;coverUrl?:string|null;price:string|number;rating:string|number;stock:number;publishedYear?:number;category:Category};
export type User={id:string;name:string;email:string;role:'CUSTOMER'|'STAFF'|'LIBRARIAN'|'ADMIN'|'AUDITOR'};
