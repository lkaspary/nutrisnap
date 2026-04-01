"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getProfiles, createProfile, deleteProfile, type Profile } from "@/lib/db";
const AVATARS=["🧑","👩","👨","🧔","👱","👩‍🦰","👩‍🦱","🧑‍🦲","👴","👵"];
const AVATAR_BG=["#EEEDFE","#E1F5EE","#E6F1FB","#FAECE7","#EAF3DE","#FAEEDA","#FBEAF0","#F1EFE8"];
export default function Home() {
  const router=useRouter();
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [loading,setLoading]=useState(true);
  const [creating,setCreating]=useState(false);
  const [name,setName]=useState("");
  const [avatar,setAvatar]=useState(AVATARS[0]);
  const [avatarBg,setAvatarBg]=useState(AVATAR_BG[0]);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{getProfiles().then(p=>{setProfiles(p);setLoading(false);});},[]);
  const handleCreate=async()=>{
    if(!name.trim())return; setSaving(true);
    const p=await createProfile({name:name.trim(),avatar,avatar_bg:avatarBg});
    setProfiles(prev=>[...prev,p]); setCreating(false); setName(""); setSaving(false);
    router.push(`/${p.id}`);
  };
  const handleDelete=async(id:string,e:React.MouseEvent)=>{
    e.stopPropagation(); await deleteProfile(id);
    setProfiles(prev=>prev.filter(p=>p.id!==id));
  };
  if(loading) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-400">Loading…</p></div>;
  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🥗</div>
        <h1 className="text-2xl font-medium">Calorie Tracker</h1>
        <p className="text-gray-500 text-sm mt-1">Who's tracking today?</p>
      </div>
      <div className="space-y-3 mb-6">
        {profiles.map(p=>(
          <button key={p.id} onClick={()=>router.push(`/${p.id}`)}
            className="w-full flex items-center gap-3 bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors text-left">
            <div className="w-11 h-11 rounded-full flex items-center justify-center text-2xl flex-shrink-0" style={{background:p.avatar_bg}}>{p.avatar}</div>
            <div className="flex-1"><p className="font-medium text-sm">{p.name}</p><p className="text-xs text-gray-400">Tap to continue</p></div>
            <button onClick={e=>handleDelete(p.id,e)} className="text-gray-300 hover:text-gray-500 text-lg px-1">✕</button>
          </button>
        ))}
      </div>
      {!creating?(
        <button onClick={()=>setCreating(true)} className="w-full border border-dashed border-gray-300 dark:border-zinc-600 rounded-2xl py-4 text-gray-400 hover:text-gray-600 hover:border-gray-400 transition-colors text-sm">+ Add profile</button>
      ):(
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-2xl p-5">
          <p className="font-medium text-sm mb-3">New profile</p>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" onKeyDown={e=>e.key==="Enter"&&handleCreate()}
            className="w-full border border-gray-200 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm mb-4 bg-transparent outline-none focus:border-gray-400"/>
          <p className="text-xs text-gray-400 mb-2">Pick an avatar</p>
          <div className="flex flex-wrap gap-2 mb-4">
            {AVATARS.map((a,i)=>(
              <button key={a} onClick={()=>{setAvatar(a);setAvatarBg(AVATAR_BG[i%AVATAR_BG.length]);}}
                className="w-10 h-10 rounded-full text-xl flex items-center justify-center transition-all"
                style={{background:avatar===a?AVATAR_BG[i%AVATAR_BG.length]:"#f5f5f5",border:avatar===a?"2px solid #888":"1px solid #e5e5e5"}}>{a}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={()=>{setCreating(false);setName("");}} className="flex-1 border border-gray-200 dark:border-zinc-600 rounded-xl py-2 text-sm text-gray-500">Cancel</button>
            <button onClick={handleCreate} disabled={!name.trim()||saving} className="flex-[2] bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-600 rounded-xl py-2 text-sm font-medium disabled:opacity-40">{saving?"Creating…":"Create profile"}</button>
          </div>
        </div>
      )}
    </div>
  );
}