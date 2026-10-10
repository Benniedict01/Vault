import { NextResponse } from 'next/server';
import { monitorAll, monitorUser } from '@/lib/monitor';
import { getSessionUserId } from '@/lib/auth';
export async function POST(req){const auth=req.headers.get('authorization');const cron=process.env.CRON_SECRET&&auth===`Bearer ${process.env.CRON_SECRET}`;const uid=await getSessionUserId();if(!cron&&!uid)return NextResponse.json({error:'Unauthorized'},{status:401});try{return NextResponse.json(cron?await monitorAll():await monitorUser(uid));}catch(e){console.error(e);return NextResponse.json({error:'Monitor failed.'},{status:500})}}
