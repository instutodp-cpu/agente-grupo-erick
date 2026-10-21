'use strict';
// Dedicated outbound-only Telegram polling process, NOT a new execution agent.
const {makeBridge}=require('../src/runtime/hermes-telegram-private-bridge');
const bridge=makeBridge({directory:process.env.HERMES_TELEGRAM_PRIVATE_DIR});
const controller=new AbortController();
for(const signal of ['SIGTERM','SIGINT'])
 process.once(signal,()=>controller.abort());
bridge.run({signal:controller.signal}).catch(()=>{
 // NEVER print errors containing Telegram token URLs or user messages.
 console.error('hermes_telegram_private_bridge_not_started');
 process.exitCode=1;
});