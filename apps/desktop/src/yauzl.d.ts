declare module 'yauzl' {
 import type {Readable} from 'node:stream';
 import type {EventEmitter} from 'node:events';
 export interface Entry {fileName:string;uncompressedSize:number;externalFileAttributes:number;generalPurposeBitFlag:number;}
 export interface ZipFile extends EventEmitter {eachEntry():AsyncIterable<Entry>;openReadStreamPromise(entry:Entry):Promise<Readable>;close():void;}
 export function fromFdPromise(fd:number,options:{autoClose:boolean;strictFileNames:boolean;validateEntrySizes:boolean}):Promise<ZipFile>;
}
