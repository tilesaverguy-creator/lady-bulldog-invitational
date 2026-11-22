const {onCall,HttpsError,onRequest}=require('firebase-functions/v2/https');
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {defineSecret}=require('firebase-functions/params');
const admin=require('firebase-admin');const twilio=require('twilio');const crypto=require('crypto');
admin.initializeApp();const db=admin.firestore();
const SID=defineSecret('TWILIO_ACCOUNT_SID'),TOKEN=defineSecret('TWILIO_AUTH_TOKEN'),VERIFY=defineSecret('TWILIO_VERIFY_SERVICE_SID'),FROM=defineSecret('TWILIO_PHONE_NUMBER');
const REGION='us-central1';const teams=new Set(['Arbor View','Bishop Gorman','Canyon Springs','Centennial','Cimarron-Memorial','Desert Oasis','Faith Lutheran','Foothill','Green Valley','Legacy','Liberty','Mojave','Palo Verde','Pinecrest Cadence','SECTA','Sierra Vista','Silverado','SLAM! NV','Sloan Canyon','Virgin Valley']);
const client=()=>twilio(SID.value(),TOKEN.value());
const phoneFormat=v=>{const n=String(v||'').replace(/\D/g,'');if(n.length===10)return '+1'+n;if(n.length===11&&n[0]==='1')return '+'+n;throw new HttpsError('invalid-argument','Enter a valid US phone number')};
const hash=p=>crypto.createHash('sha256').update(p).digest('hex');
const random=()=>crypto.randomBytes(24).toString('hex');
exports.startSubscription=onCall({region:REGION,secrets:[SID,TOKEN,VERIFY],enforceAppCheck:true},async req=>{
 const {team,phone,consent}=req.data||{};if(!consent||!teams.has(team))throw new HttpsError('invalid-argument','Select a team and agree to receive texts');
 const number=phoneFormat(phone),token=random();
 // Never return or publicly expose subscriber phone numbers.
 await db.collection('pendingSubscriptions').doc(token).set({phone:number,team,createdAt:admin.firestore.FieldValue.serverTimestamp(),expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+10*60*1000)});
 await client().verify.v2.services(VERIFY.value()).verifications.create({to:number,channel:'sms'});
 return {token};
});
exports.confirmSubscription=onCall({region:REGION,secrets:[SID,TOKEN,VERIFY],enforceAppCheck:true},async req=>{
 const {token,code}=req.data||{};if(typeof token!=='string'||!/^\d{4,10}$/.test(String(code||'')))throw new HttpsError('invalid-argument','Invalid verification code');
 const ref=db.collection('pendingSubscriptions').doc(token),snap=await ref.get();if(!snap.exists||snap.data().expiresAt.toMillis()<Date.now())throw new HttpsError('failed-precondition','Verification expired');
 const {phone,team}=snap.data(),result=await client().verify.v2.services(VERIFY.value()).verificationChecks.create({to:phone,code:String(code)});
 if(result.status!=='approved')throw new HttpsError('permission-denied','Verification failed');
 await db.collection('subscriptions').doc(hash(phone+'|'+team)).set({phone,team,active:true,verifiedAt:admin.firestore.FieldValue.serverTimestamp(),consentText:'I consent to automated Lady Bulldog Invitational game notifications at this number. Consent is optional.',source:'public signup',lastNotified:{}},{merge:true});
 await ref.delete();return {ok:true};
});
// Twilio must be configured to POST inbound SMS to this endpoint. Validates Twilio signature.
exports.inboundSms=onRequest({region:REGION,secrets:[TOKEN]},async(req,res)=>{
 if(req.method!=='POST')return res.status(405).end();
 const sig=req.headers['x-twilio-signature'];const url=process.env.TWILIO_WEBHOOK_URL;
 if(!url||!twilio.validateRequest(TOKEN.value(),sig,url,req.body))return res.status(403).end();
 const command=String(req.body.Body||'').trim().toUpperCase();
 if(['STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT'].includes(command)){
  const number=req.body.From;const subs=await db.collection('subscriptions').where('phone','==',number).get();
  const batch=db.batch();subs.docs.forEach(doc=>batch.update(doc.ref,{active:false,stoppedAt:admin.firestore.FieldValue.serverTimestamp()}));await batch.commit();
 }
 res.set('Content-Type','text/xml').send('<Response></Response>');
});
function resolve(spec,lookup,depth=0){if(!spec||depth>12)return null;if(spec.type==='team')return spec.id;const g=lookup.get(spec.id);if(!g?.final)return null;const a=resolve(g.a,lookup,depth+1),b=resolve(g.b,lookup,depth+1);if(!a||!b)return null;return spec.type==='winner'?(+g.sa>+g.sb?a:b):(+g.sa>+g.sb?b:a)}
function nextGames(state){const games=state?.games||[],lookup=new Map(games.map(g=>[g.key,g]));const byTeam={};
 for(const g of games){if(!g.a||!g.b||g.final)continue;const a=resolve(g.a,lookup),b=resolve(g.b,lookup);if(!a||!b)continue;
  for(const [team,opponent] of [[a,b],[b,a]]){const item={game:g.slot*5+g.field,slot:g.slot,field:g.field,opponent};if(!byTeam[team]||item.slot<byTeam[team].slot)byTeam[team]=item;}
 }return byTeam;
}
const timeLabels=['Friday 2 PM','Friday 4 PM','Friday 6 PM','Saturday 9 AM','Saturday 11 AM','Saturday 1 PM','Saturday 3 PM','Saturday 5 PM'];
exports.notifyScheduleChanges=onDocumentWritten({document:'tournaments/lady-bulldog',region:REGION,secrets:[SID,TOKEN,FROM]},async event=>{
 const before=event.data.before.data()?.state,after=event.data.after.data()?.state;if(!after)return;
 const prev=nextGames(before),next=nextGames(after),jobs=[];
 for(const [team,item] of Object.entries(next)){
  if(JSON.stringify(prev[team])===JSON.stringify(item))continue;
  const subs=await db.collection('subscriptions').where('team','==',team).where('active','==',true).get();
  for(const s of subs.docs){const dedupe=hash(`${event.id}|${s.id}|${JSON.stringify(item)}`);const ref=db.collection('notificationEvents').doc(dedupe);
   jobs.push((async()=>{try{await ref.create({createdAt:admin.firestore.FieldValue.serverTimestamp(),status:'pending'});}catch(e){if(e.code===6)return;throw e}
    try{await client().messages.create({to:s.data().phone,from:FROM.value(),body:`Lady Bulldog Invitational: ${team} next plays ${item.opponent}, ${timeLabels[item.slot]}, Field ${item.field} (Game ${item.game}). See the live bracket for updates. Reply STOP to unsubscribe.`});await ref.update({status:'sent'});}catch(e){await ref.update({status:'failed',error:String(e.message).slice(0,300)});throw e}
   })());
  }
 }
 await Promise.allSettled(jobs);
});
