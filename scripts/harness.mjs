import fs from 'fs';
for (const l of fs.readFileSync(new URL('../lokaal.env', import.meta.url),'utf8').split('\n')) { const m=l.match(/^([A-Z_]+)=(.+)$/); if (m) process.env[m[1]]=m[2]; }
export async function call(name, method, { body, query } = {}) {
  const { default: h } = await import(`../api/dashboard/${name}.js`);
  return new Promise((resolve) => {
    const res = { statusCode:200, setHeader(){}, status(c){this.statusCode=c;return this;},
      json(o){resolve({status:this.statusCode,...o});return this;}, end(){resolve({status:this.statusCode});return this;} };
    h({ method, body, query: query||{}, headers:{'x-admin-key':'lokaal-test'} }, res);
  });
}
