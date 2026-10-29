// @vitest-environment node
import{it,expect}from'vitest';import{parseCatalogQuery}from'./catalog';
it('parses bounded native catalog filters and rejects ambiguous or invalid input',()=>{
 expect(parseCatalogQuery(new URLSearchParams('page=2&view=reviews&visibility=archived&seriesId=unassigned'))).toMatchObject({page:2,view:'reviews',visibility:'archived',seriesId:'unassigned'});
 for(const query of['page=0','page=-1','page=1.1','page=1000000000','page=1&page=2','view=unknown','visibility=unknown','accountId=invalid','seriesId=invalid','secret=ignored'])expect(()=>parseCatalogQuery(new URLSearchParams(query))).toThrow();
});
it('accepts bounded title/id search, whitelisted order and action status with compatible defaults',()=>{
 expect(parseCatalogQuery(new URLSearchParams())).toMatchObject({q:'',sort:'updated',status:'all'});
 expect(parseCatalogQuery(new URLSearchParams('q=%20%E7%94%9F%E4%BA%A7%E5%8D%95%2027%20&sort=title&status=review'))).toMatchObject({q:'生产单 27',sort:'title',status:'review'});
 for(const query of ['q='+encodeURIComponent('x'.repeat(201)),'q=%00bad','q=%0Abad','sort=updated%20desc','status=unknown','q=a&q=b','sort=oldest&sort=title','status=all&status=done'])expect(()=>parseCatalogQuery(new URLSearchParams(query))).toThrow();
});
