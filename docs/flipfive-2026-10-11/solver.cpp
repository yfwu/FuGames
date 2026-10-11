#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>
using namespace std;
using Board=array<uint8_t,81>;
struct Move {int cell,flips,win,score; Board board;};
vector<vector<int>> rays[81]; vector<array<int,5>> segments; vector<int> through[81];
uint64_t nodes=0,generated=0,cacheHits=0; int rootPlayer=1,beam=0; uint64_t nodeCap=3000000; double seconds=30; bool aborted=false;
chrono::steady_clock::time_point begun;
unordered_map<string,bool> memo;
bool inside(int r,int c){return r>=0&&r<9&&c>=0&&c<9;}
void init(){
 for(int i=0;i<81;i++)for(int dr=-1;dr<=1;dr++)for(int dc=-1;dc<=1;dc++)if(dr||dc){vector<int> ray;for(int r=i/9+dr,c=i%9+dc;inside(r,c);r+=dr,c+=dc)ray.push_back(r*9+c);rays[i].push_back(ray);}
 for(int r=0;r<9;r++)for(int c=0;c<9;c++)for(auto d:vector<pair<int,int>>{{0,1},{1,0},{1,1},{1,-1}})if(inside(r+d.first*4,c+d.second*4)){array<int,5>s;for(int k=0;k<5;k++){s[k]=(r+k*d.first)*9+c+k*d.second;through[s[k]].push_back(segments.size());}segments.push_back(s);}
}
int terminal(const Board&b){int mask=0;for(auto&s:segments){int p=b[s[0]];if(p&&all_of(s.begin(),s.end(),[&](int x){return b[x]==p;}))mask|=p==1?1:2;}if(mask)return mask==3?0:mask==1?1:2;int a=0,z=0;for(int x:b){a+=x==1;z+=x==0;}if(!z)return a*2==81?0:a*2>81?1:2;return -1;}
Move apply(const Board&b,int cell,int p){
 generated++;Move m{cell,0,-1,0,b};m.board[cell]=p;vector<int>changed{cell};
 for(auto&ray:rays[cell]){int n=0;while(n<(int)ray.size()&&b[ray[n]]==3-p)n++;if(n>0&&n<(int)ray.size()&&b[ray[n]]==p)for(int j=0;j<n;j++){m.board[ray[j]]=p;changed.push_back(ray[j]);m.flips++;}}
 // A legal play from a nonterminal state can only create the mover's line.
 for(int x:changed)for(int si:through[x]){auto&s=segments[si];if(all_of(s.begin(),s.end(),[&](int y){return m.board[y]==p;})){m.win=p;return m;}}
 bool full=true;int a=0;for(int x:m.board){full&=x!=0;a+=x==1;}if(full)m.win=a*2>81?1:2;return m;
}
int evaluate(const Board&b,int p){static const int w[]={0,1,9,70,850,50000};int v=0;for(auto&s:segments){int a=0,o=0;for(int i:s){a+=b[i]==p;o+=b[i]==3-p;}if(!o)v+=w[a]*20;if(!a)v-=w[o]*23;}return v;}
vector<Move> moves(const Board&b,int p){vector<Move>v;for(int i=0;i<81;i++)if(!b[i]){auto m=apply(b,i,p);m.score=m.win==p?100000000:evaluate(m.board,p)+(8-abs(i/9-4)-abs(i%9-4))*2+m.flips*20;v.push_back(move(m));}sort(v.begin(),v.end(),[](auto&a,auto&b){return a.score!=b.score?a.score>b.score:a.cell<b.cell;});return v;}
int immediate(const Board&b,int p){for(int i=0;i<81;i++)if(!b[i]&&apply(b,i,p).win==p)return i;return -1;}
void checkBudget(){nodes++;if(nodes>nodeCap||((nodes&4095)==0&&chrono::duration<double>(chrono::steady_clock::now()-begun).count()>seconds)){aborted=true;throw runtime_error("budget");}}
string key(const Board&b,int p,int d){string s;for(auto x:b)s.push_back('0'+x);s.push_back('0'+p);s.push_back(char(d));return s;}
// TRUE proves attacker wins within d plies. FALSE is only an exact horizon
// refutation when beam=0 (all attacking moves), otherwise it means not found.
bool prove(const Board&b,int p,int d,int*chosen=nullptr){
 checkBudget();if(d==0)return false;
 auto k=key(b,p,d);auto it=memo.find(k);if(it!=memo.end()&&!chosen){cacheHits++;return it->second;}
 if(p==rootPlayer){int w=immediate(b,p);if(w>=0){if(chosen)*chosen=w;memo[k]=true;return true;}if(d==1){memo[k]=false;return false;}}
 auto choices=moves(b,p);int count=0;
 for(auto&m:choices){
   bool v;
   if(m.win>=0)v=m.win==rootPlayer;
   else if(d==1)v=false;
   else if(p!=rootPlayer&&immediate(m.board,rootPlayer)>=0)v=true;
   else v=prove(m.board,3-p,d-1);
   if(p==rootPlayer&&v){if(chosen)*chosen=m.cell;memo[k]=true;return true;}
   if(p!=rootPlayer&&!v){if(chosen)*chosen=m.cell;memo[k]=false;return false;}
   if(p==rootPlayer&&beam>0&&++count>=beam)break;
 }
 bool v=p!=rootPlayer;memo[k]=v;return v;
}
string coord(int i){return string(1,'A'+i%9)+to_string(i/9+1);}
int cell(string s){if(s.size()<2)throw runtime_error("bad coordinate");return (s[1]-'1')*9+toupper(s[0])-'A';}
Board parse(string s){Board b{};if(s.size()!=81)throw runtime_error("board must have 81 digits");for(int i=0;i<81;i++){if(s[i]<'0'||s[i]>'2')throw runtime_error("bad board");b[i]=s[i]-'0';}return b;}
string serial(const Board&b){string s;for(int x:b)s+=char('0'+x);return s;}
struct Record {Board board;int player,depth,winner;vector<pair<int,int>>edges;};
void reset();
vector<Record> records;unordered_map<string,int> recordIds;
int certificate(const Board&b,int p,int d){
 string k=key(b,p,d);auto it=recordIds.find(k);if(it!=recordIds.end())return it->second;
 int id=records.size(),w=terminal(b);recordIds[k]=id;records.push_back({b,p,d,w,{}});
 if(w>=0){if(w!=rootPlayer)throw runtime_error("nonwinning proof leaf");return id;}
 if(d<=0)throw runtime_error("nonterminal proof leaf");
 if(p==rootPlayer){int chosen=-1;if(!prove(b,p,d,&chosen)||chosen<0)throw runtime_error("missing attack witness");auto next=apply(b,chosen,p);int child=certificate(next.board,3-p,d-1);records[id].edges.push_back({chosen,child});}
 else for(int i=0;i<81;i++)if(!b[i]){auto next=apply(b,i,p);int child=certificate(next.board,3-p,d-1);records[id].edges.push_back({i,child});}
 return id;
}
void emitCertificate(const Board&b,int p,int d){reset();if(terminal(b)<0&&!prove(b,p,d))throw runtime_error("not a proven win");int root=certificate(b,p,d);cout<<"{\"attacker\":"<<rootPlayer<<",\"horizonPlies\":"<<d<<",\"root\":"<<root<<",\"records\":[";for(int i=0;i<(int)records.size();i++){if(i)cout<<",";auto&r=records[i];cout<<"{\"board\":\""<<serial(r.board)<<"\",\"turn\":"<<r.player<<",\"depth\":"<<r.depth<<",\"winner\":"<<r.winner<<",\"edges\":[";for(int j=0;j<(int)r.edges.size();j++){if(j)cout<<",";cout<<"["<<r.edges[j].first<<","<<r.edges[j].second<<"]";}cout<<"]}";}cout<<"],\"nodes\":"<<nodes<<",\"generatedSuccessors\":"<<generated<<",\"cacheHits\":"<<cacheHits<<",\"seconds\":"<<chrono::duration<double>(chrono::steady_clock::now()-begun).count()<<"}"<<endl;}
void reset(){nodes=generated=cacheHits=0;aborted=false;memo.clear();begun=chrono::steady_clock::now();}
void output(const Board&b,int turn,int depth){reset();int chosen=-1;bool value=false;try{int t=terminal(b);value=t>=0?t==rootPlayer:prove(b,turn,depth,&chosen);}catch(const runtime_error& e){if(string(e.what())!="budget")throw;}
 cout<<"{\"board\":\""<<serial(b)<<"\",\"turn\":"<<turn<<",\"attacker\":"<<rootPlayer<<",\"horizonPlies\":"<<depth<<",\"attackerBeam\":"<<beam<<",\"status\":\""<<(aborted?"budget_exhausted":value?"proven_win":beam?"not_found_restricted_attack":"no_forced_win_within_horizon")<<"\",\"choice\":\""<<(chosen<0?"":coord(chosen))<<"\",\"nodes\":"<<nodes<<",\"generatedSuccessors\":"<<generated<<",\"cacheHits\":"<<cacheHits<<",\"seconds\":"<<chrono::duration<double>(chrono::steady_clock::now()-begun).count()<<"}"<<endl;
}
int main(int argc,char**argv){init();string mode="prove",board(81,'0'),sequence="";int turn=1,depth=5;for(int i=1;i<argc;i++){string a=argv[i];if(a=="--mode")mode=argv[++i];else if(a=="--board")board=argv[++i];else if(a=="--line")sequence=argv[++i];else if(a=="--turn")turn=stoi(argv[++i]);else if(a=="--attacker")rootPlayer=stoi(argv[++i]);else if(a=="--depth")depth=stoi(argv[++i]);else if(a=="--beam")beam=stoi(argv[++i]);else if(a=="--nodes")nodeCap=stoull(argv[++i]);else if(a=="--seconds")seconds=stod(argv[++i]);else throw runtime_error("unknown argument "+a);}
 Board b=parse(board);if(!sequence.empty()){stringstream ss(sequence);string s;turn=1;while(ss>>s){int i=cell(s);if(i<0||i>=81||b[i]||terminal(b)>=0)throw runtime_error("illegal sequence");b=apply(b,i,turn).board;turn=3-turn;}}
 if(mode=="prove")output(b,turn,depth);
 else if(mode=="certificate")emitCertificate(b,turn,depth);
 else if(mode=="audit"){cout<<"[";bool first=true;for(int i=0;i<81;i++)if(!b[i]){auto m=apply(b,i,turn);if(!first)cout<<",";first=false;cout<<"{\"candidate\":\""<<coord(i)<<"\",\"result\":";output(m.board,3-turn,depth-1);cout<<"}"<<endl;}cout<<"]"<<endl;}
 else if(mode=="moves"){for(int i=0;i<81;i++)if(!b[i]){auto m=apply(b,i,turn);cout<<"{\"cell\":"<<i<<",\"flips\":"<<m.flips<<",\"winner\":"<<m.win<<",\"board\":\""<<serial(m.board)<<"\"}"<<endl;}}
 else throw runtime_error("unknown mode");
}
