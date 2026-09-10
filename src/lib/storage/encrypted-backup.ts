import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
const magic=Buffer.from('ORCHBK01');
const maxBytes=256*1024*1024;
function key(password:string,salt:Buffer){if(password.length<16)throw new Error('Backup passphrase must contain at least 16 characters');return scryptSync(password,salt,32);}
/** Bounded in-memory archive encryption, not a PostgreSQL backup producer.
 * Larger streaming database exports are a separate release requirement. */
export function encryptBackup(data:Buffer,password:string){
 if(data.length>maxBytes)throw new Error('Backup exceeds bounded archive size');
 const salt=randomBytes(16),iv=randomBytes(12),header=Buffer.concat([magic,salt,iv]);
 const cipher=createCipheriv('aes-256-gcm',key(password,salt),iv);cipher.setAAD(header);
 const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);
 return Buffer.concat([header,cipher.getAuthTag(),encrypted]);
}
export function decryptBackup(data:Buffer,password:string){
 if(data.length<52||data.length>maxBytes+52||!data.subarray(0,8).equals(magic))throw new Error('Invalid backup envelope');
 const decipher=createDecipheriv('aes-256-gcm',key(password,data.subarray(8,24)),data.subarray(24,36));
 decipher.setAAD(data.subarray(0,36));decipher.setAuthTag(data.subarray(36,52));
 return Buffer.concat([decipher.update(data.subarray(52)),decipher.final()]);
}
