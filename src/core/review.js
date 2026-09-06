// A selected paragraph is shown identically on both sides; source text remains immutable.
export function paragraphPresentation(scene,change,choice){
  if(choice==='old'||choice==='new'){
    const range=choice==='old'?change.a:change.b;
    return {resolved:true,choice,text:range[0]===range[1]?null:scene[choice][range[0]]};
  }
  return {resolved:false,rows:change.rows};
}
