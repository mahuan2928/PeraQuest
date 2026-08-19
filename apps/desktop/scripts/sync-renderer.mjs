import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
const source=resolve(import.meta.dirname,'../../web/dist');const target=resolve(import.meta.dirname,'../dist/renderer');await mkdir(target,{recursive:true});await cp(source,target,{recursive:true})
