import {expect,it} from 'vitest';
import {readCatalogNavigation,catalogNavigationUrl} from './catalogNavigation';
it('opens legacy episode links and discards unsupported locations and malformed paging',()=>{
 const legacy=readCatalogNavigation('?episode=episode-one');expect(legacy.view).toBe('episodes');expect(legacy.episode).toBe('episode-one');
 const invalid=readCatalogNavigation('?view=secrets&episode=../../other&step=approve&tab=credentials&page=-1&pendingPage=99999999&visibility=hidden&status=approved&sort=unsafe');expect(invalid).toMatchObject({view:'operations',episode:'',step:null,tab:'visual',filters:{page:1,pendingPage:1,visibility:'active',status:'all',sort:'updated'}});
});
it('keeps independently known list, workspace and read-only history positions in a shareable URL',()=>{
 const value=readCatalogNavigation('?view=episodes&accountId=account-one&seriesId=series-one&q=山&status=blocked&page=3&episode=episode-one&step=preparation&tab=voice&historyTab=sources&historyPage=2');
 const url=catalogNavigationUrl(value,'http://localhost/workspace?unrelated=yes#main');expect(url).toBe('/workspace?unrelated=yes&view=episodes&episode=episode-one&step=preparation&tab=voice&page=3&accountId=account-one&seriesId=series-one&q=%E5%B1%B1&status=blocked&historyTab=sources&historyPage=2#main');
});
it('restores paged global search without dropping the current production or unrelated URL context',()=>{
 const value=readCatalogNavigation('?view=episodes&episode=episode-one&step=preparation&searchQ=%E9%87%91%E5%B1%B1&searchCategory=materials&searchPage=3');expect(value.panels.search).toEqual({q:'金山',category:'materials',page:3});
 const url=catalogNavigationUrl(value,'http://localhost/?outside=kept#main');expect(url).toContain('outside=kept');expect(url).toContain('episode=episode-one');expect(url).toContain('searchCategory=materials');expect(url).toContain('searchPage=3');expect(readCatalogNavigation(new URL(url,'http://localhost').search).panels.search).toEqual(value.panels.search);
 expect(readCatalogNavigation('?searchQ=x&searchCategory=secret&searchPage=-3').panels.search).toEqual({q:'x',category:'all',page:1});
});
it('serializes a closed search destination without losing the full-result return context',()=>{
 const value=readCatalogNavigation('?view=episodes&episode=episode-one&searchQ=金山&searchCategory=materials&searchPage=2&searchOpen=0');expect(value.panels.search).toEqual({q:'金山',category:'materials',page:2,open:false});const url=catalogNavigationUrl(value,'http://localhost/?outside=kept');expect(url).toContain('searchOpen=0');expect(url).toContain('outside=kept');expect(readCatalogNavigation(new URL(url,'http://localhost').search).panels.search.open).toBe(false);
});
