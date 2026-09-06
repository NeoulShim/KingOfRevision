export function registerTools(app,context=globalThis.document?.modelContext){
  if(!context?.registerTool)return ()=>{};
  const lifecycle=new AbortController();
  const empty={type:'object',properties:{},additionalProperties:false};
  const validate=(input,allowed=[])=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw Error('지원하지 않는 입력입니다.');};
  const definitions=[
    {name:'read_revision_summary',title:'현재 비교 요약 읽기',description:'현재 열린 비교의 장면 수와 검토 진행률을 읽습니다. 원고 본문은 반환하지 않습니다.',inputSchema:empty,annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){validate(input);return app.getSummary()}},
    {name:'start_example_comparison',title:'예제로 비교 시작',description:'사용 화면의 예제로 비교하기와 동일하게 예제 원문과 개고안을 엽니다. 현재 화면의 원고 비교가 예제로 바뀝니다.',inputSchema:empty,annotations:{readOnlyHint:false,untrustedContentHint:false},async execute(input){validate(input);await app.demo();return app.getSummary()}},
    {name:'navigate_revision_page',title:'설명서 또는 사용 화면 열기',description:'설명서 또는 사용 화면으로 이동합니다. 원고와 선택은 유지됩니다.',inputSchema:{type:'object',properties:{page:{type:'string',enum:['guide','use']}},required:['page'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){validate(input,['page']);if(!['guide','use'].includes(input.page))throw Error('page는 guide 또는 use여야 합니다.');app.showPage(input.page);return {page:input.page}}}
  ];
  for(const tool of definitions){try{Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{})}catch{}}
  return ()=>lifecycle.abort();
}
