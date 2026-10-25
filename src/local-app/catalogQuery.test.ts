// @vitest-environment node
import{it,expect}from'vitest';import{parseCatalogQuery}from'./catalog';
it('parses bounded native catalog filters and rejects ambiguous or invalid input',()=>{
 expect(parseCatalogQuery(new URLSearchParams('page=2&view=reviews&visibility=archived&seriesId=unassigned'))).toMatchObject({page:2,view:'reviews',visibility:'archived',seriesId:'unassigned'});
 for(const query of['page=0','page=-1','page=1.1','page=1000000000','page=1&page=2','view=unknown','visibility=unknown','accountId=invalid','seriesId=invalid','secret=ignored'])expect(()=>parseCatalogQuery(new URLSearchParams(query))).toThrow();
});
