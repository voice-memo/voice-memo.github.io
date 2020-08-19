
export function debug(msg, func) {
  const startTime = Date.now();
  const res = await func();
  console.log(msg, (Date.now() - startTime) / 1000);
  return res;
 
}