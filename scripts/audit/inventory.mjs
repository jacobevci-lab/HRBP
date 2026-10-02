import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import ts from 'typescript';
export async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, {withFileTypes:true})) {
    const p = `${dir}/${ent.name}`;
    if (ent.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out.sort();
}
const sourceFiles = (await Promise.all(['app','components','lib'].map(walk))).flat().filter(p=>/\.(tsx?|mjs)$/.test(p));
const navigation = await readFile('lib/navigation.ts','utf8');
const modules = [...navigation.matchAll(/slug\s*:\s*["']([^"']+)["']/g)].map(m=>m[1]);
function routePath(file) {
  return '/' + file.replace(/^app\//,'').replace(/\/(?:page|route)\.tsx?$/,'').replace(/^(?:page|route)\.tsx?$/,'').split('/').filter(p=>p&&!p.startsWith('(')&&!p.startsWith('@')).join('/');
}
const pages = sourceFiles.filter(p=>/\/page\.tsx?$/.test(p)).map(file=>({file,path:routePath(file)}));
const apis = [], links = [], buttons = [], fetches = [];
function value(node) {
  if (!node) return null;
  if (ts.isJsxExpression(node)||ts.isParenthesizedExpression(node)||ts.isAsExpression(node)) return value(node.expression);
  if (ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node)) return {path:node.text,dynamic:false};
  if (ts.isTemplateExpression(node)) return {path:node.head.text+node.templateSpans.map(s=>'__dynamic__'+s.literal.text).join(''),dynamic:true};
  return null;
}
for (const file of sourceFiles) {
  const text = await readFile(file,'utf8');
  const ast = ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  if (/\/route\.ts$/.test(file)) {
    const methods = [];
    for (const node of ast.statements) if (ts.isFunctionDeclaration(node)&&node.name&&node.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(node.name.text)) methods.push(node.name.text);
    apis.push({file,path:routePath(file),methods});
  }
  function record(target,node,kind,dest) {
    if (!dest) return;
    const {line} = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    target.push({file,line:line+1,kind,...dest});
  }
  function visit(node) {
    if (ts.isJsxAttribute(node)&&node.name.getText(ast)==='href') record(links,node,'jsx-href',value(node.initializer));
    if (ts.isPropertyAssignment(node)&&['href','url','path'].includes(node.name.getText(ast).replace(/["']/g,''))) {
      const v=value(node.initializer); if(v?.path.startsWith('/')) record(links,node,'object-link',v);
    }
    if (ts.isCallExpression(node)) {
      const callee=node.expression.getText(ast);
      if(callee==='fetch') record(fetches,node,'fetch',value(node.arguments[0]));
      if(/(?:router\.(?:push|replace)|location\.(?:assign|replace))$/.test(callee)) record(links,node,'navigation',value(node.arguments[0]));
    }
    if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) if(node.tagName.getText(ast)==='button') {
      const attrs=node.attributes.properties, names=attrs.filter(ts.isJsxAttribute).map(a=>a.name.getText(ast));
      let inForm=false,p=node.parent;
      while(p) {if(ts.isJsxElement(p)&&p.openingElement.tagName.getText(ast)==='form'){inForm=true;break;}p=p.parent;}
      const type=attrs.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='type');
      if(!names.includes('onClick')&&!names.includes('disabled')&&!names.includes('formAction')&&!attrs.some(ts.isJsxSpreadAttribute)&&!(inForm&&value(type?.initializer)?.path!=='button')) record(buttons,node,'button-review',{path:text.slice(node.getStart(ast),Math.min(node.getEnd()+160,text.length)).replace(/\s+/g,' ').slice(0,220),dynamic:false});
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
}
function matches(pattern,path) {
  const segments=pattern.split('/').filter(Boolean),actual=path.split('/').filter(Boolean);
  for(let i=0;i<segments.length;i++) {
    const s=segments[i];
    if(s.startsWith('[[...')) return true;
    if(s.startsWith('[...')) return actual.length>i;
    if(actual[i]===undefined) return false;
    if(!s.startsWith('[')&&s!==actual[i]) return false;
  }
  return segments.length===actual.length;
}
const publicFiles=await walk('public').catch(()=>[]);
function resolution(item) {
  const p=item.path.split(/[?#]/)[0];
  if(!p.startsWith('/')||p.startsWith('//')) return 'external-or-relative';
  if(p.includes('__dynamic__')) return 'dynamic-review';
  if(p.startsWith('/module/')&&![...modules,'notifications'].includes(p.split('/')[2])) return 'unknown-module';
  return [...pages,...apis].some(r=>matches(r.path,p))||publicFiles.includes('public'+p)?'resolved':'missing-route';
}
const report={version:1,scope:'Source inventory only; not proof of runtime or feature correctness.',counts:{sources:sourceFiles.length,modules:modules.length,pages:pages.length,apiRoutes:apis.length,apiMethods:apis.reduce((s,a)=>s+a.methods.length,0),links:links.length,fetches:fetches.length,buttonsRequiringReview:buttons.length},modules,pages,apis,links:links.map(l=>({...l,resolution:resolution(l)})),fetches:fetches.map(l=>({...l,resolution:resolution(l)})),buttons};
await mkdir('audit-results',{recursive:true});
await writeFile('audit-results/inventory.json',JSON.stringify(report,null,2));
console.log('AUDIT_INVENTORY '+JSON.stringify(report.counts));
for(const l of [...report.links,...report.fetches].filter(l=>['unknown-module','missing-route'].includes(l.resolution))) console.log('AUDIT_LINK_REVIEW '+JSON.stringify(l));
for(const b of buttons) console.log('AUDIT_BUTTON_REVIEW '+JSON.stringify(b));
