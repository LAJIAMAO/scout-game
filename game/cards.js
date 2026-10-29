'use strict';
function deckFor(count, random=Math.random) {
  if(!Number.isInteger(count)||count<2||count>5) throw new Error('玩家人数必须为 2–5');
  const deck=[];let id=0;
  for(let a=1;a<=9;a++) for(let b=a+1;b<=10;b++) {
    id++;
    if(count===3 && b===10 || (count===2||count===4) && a===9&&b===10) continue;
    deck.push(random()<.5?{id,top:a,bottom:b}:{id,top:b,bottom:a});
  }
  for(let i=deck.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
  return deck;
}
function deal(deck,count) {
  const n=count===3?12:count===5?9:11;
  const hands=Array.from({length:count},()=>[]);
  // Deal clockwise, preserving the dealt order of each pile.
  for(let i=0;i<n*count;i++) hands[i%count].push({...deck[i]});
  return {hands, reserve:deck.slice(n*count).map(c=>({...c}))};
}
module.exports={deckFor,deal};
