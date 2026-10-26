import{StrictMode}from'react';
import{createRoot}from'react-dom/client';
import{LocalCatalogApp}from'./LocalCatalogApp';
import'../styles.css';
const root=document.getElementById('root');
if(!root)throw Error('The application root is missing.');
createRoot(root).render(<StrictMode><LocalCatalogApp/></StrictMode>);
