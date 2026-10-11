#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
using namespace std;
constexpr int N=9, CELLS=81, INF=20000000, WIN=10000000;
struct State { array<uint8_t,CELLS> b{}; int turn=1, pending=0, winner=-1, last=-1, ply=0, captures=0; };
struct Move {int cell; State s; int score;};
vector<array<int,5>> segments;
vector<array<int,2>> rays={{-1,-1},{-1,0},{-1,1},{0,-1},{0,1},{1,-1},{1,0},{1,1}};
string variant="baseline";
bool inside(int r,int c){return r>=0&&c>=0&&r<N&&c<N;}
void setup(){for(int r=0;r<N;r++)for(int c=0;c<N;c++)for(auto d:vector<array<int,2>>{{0,1},{1,0},{1,1},{1,-1}})if(inside(r+4*d[0],c+4*d[1])){array<int,5>a;for(int k=0;k<5;k++)a[k]=(r+k*d[0])*N+c+k*d[1];segments.push_back(a);}}
array<bool,3> fives(const State&s){array<bool,3> has{};for(auto&a:segments){int p=s.b[a[0]];if(p&&all_of(a.begin()+1,a.end(),[&](int i){return s.b[i]==p;}))has[p]=true;}return has;}
State step(const State&s,int cell){State t=s;int p=s.turn,q=3-p;t.turn=q;t.last=cell;t.ply++;t.b[cell]=p;array<bool,81> fresh{};int flips=0;
 for(auto d:rays){int r=cell/9+d[0],c=cell%9+d[1];vector<int> ray;while(inside(r,c)&&s.b[r*9+c]==q){ray.push_back(r*9+c);r+=d[0];c+=d[1];}if(!ray.empty()&&inside(r,c)&&s.b[r*9+c]==p){if(variant=="shield"&&find(ray.begin(),ray.end(),s.last)!=ray.end())continue;for(int i:ray){t.b[i]=p;fresh[i]=true;flips++;}}}
 t.captures+=flips;auto has=fives(t);bool a=false,b=false;
 if(variant=="baseline"||variant=="shield"||t.ply==81){a=has[1];b=has[2];t.pending=0;}
 else {bool currentQualified=false;if(variant=="capture-grace")for(auto&seg:segments){bool eligible=true;for(int i:seg)if(t.b[i]!=p||fresh[i]){eligible=false;break;}if(eligible){currentQualified=true;break;}}bool priorQualified=(s.pending==q&&has[q]);a=p==1?currentQualified:priorQualified;b=p==2?currentQualified:priorQualified;t.pending=has[p]?p:0;}
 if(a||b)t.winner=a&&b?0:a?1:2;else if(t.ply==81){int count=0;for(int x:t.b)count+=x==1;t.winner=count*2==81?0:count*2>81?1:2;}return t;
}
int evaluate(const State&s,int p,string profile){if(s.winner>=0)return s.winner==0?0:s.winner==p?WIN:-WIN;static int weights[]={0,2,16,150,2200,450000};int value=0;for(auto&a:segments){int own=0,other=0;for(int i:a){own+=s.b[i]==p;other+=s.b[i]==3-p;}if(!other)value+=weights[own];if(!own)value-=weights[other];}if(s.pending)value+=(s.pending==p?1:-1)*150000;for(int i=0;i<81;i++)if(s.b[i])value+=(s.b[i]==p?1:-1)*(8-abs(i/9-4)-abs(i%9-4)+(profile=="capture"?12:0));return value;}
vector<Move> children(const State&s,string profile){vector<Move> moves;for(int i=0;i<81;i++)if(!s.b[i]){State t=step(s,i);moves.push_back({i,t,evaluate(t,s.turn,profile)});}sort(moves.begin(),moves.end(),[](auto&a,auto&b){return a.score!=b.score?a.score>b.score:a.cell<b.cell;});return moves;}
bool immediate(const State&s,int p){State t=s;t.turn=p;for(int i=0;i<81;i++)if(!t.b[i]&&step(t,i).winner==p)return true;return false;}
struct Search {long nodes=0,budget=100000;int width=12;bool stopped=false;string profile="line"; int negamax(const State&s,int depth,int alpha,int beta){nodes++;if(nodes>budget){stopped=true;return evaluate(s,s.turn,profile);}if(s.winner>=0||depth==0)return evaluate(s,s.turn,profile);auto moves=children(s,profile);if(moves.empty())return 0;if(moves[0].s.winner==s.turn)return WIN+depth;int best=-INF;int count=0;for(auto&m:moves){if(count++>=width)break;int v=-negamax(m.s,depth-1,-beta,-alpha);best=max(best,v);alpha=max(alpha,v);if(alpha>=beta||stopped)break;}return best;}
 pair<int,int> choose(const State&s,int depth){auto moves=children(s,profile);if(moves.empty())return {-1,0};for(auto&m:moves)if(m.s.winner==s.turn)return {m.cell,WIN}; // All legal immediate wins are inspected.
 // A complete one-reply screen precedes quiet beam search at the root. It never drops an only legal immediate defense.
 for(auto&m:moves)if(m.s.winner<0&&immediate(m.s,3-s.turn))m.score-=2*WIN;
 stable_sort(moves.begin(),moves.end(),[](auto&a,auto&b){return a.score>b.score;});int cell=moves[0].cell,value=moves[0].score,alpha=-INF;int count=0;
 for(auto&m:moves){if(count++>=width)break;int v=m.score<-WIN?(-WIN+1):-negamax(m.s,depth-1,-INF,-alpha);if(v>alpha){alpha=v;cell=m.cell;value=v;}if(stopped)break;}return {cell,value};}
};
string coord(int c){return string(1,'A'+c%9)+to_string(c/9+1);}
uint32_t rng(uint32_t&x){x^=x<<13;x^=x>>17;x^=x<<5;return x;}
int main(int argc,char**argv){setup();variant=argc>1?argv[1]:"baseline";string mode=argc>2?argv[2]:"match";if(mode=="fixture"){string raw=argv[3];State s;for(int i=0;i<81;i++){s.b[i]=raw[i]-'0';s.ply+=s.b[i]!=0;}s.turn=stoi(argv[4]);s.pending=argc>5?stoi(argv[5]):0;for(auto&m:children(s,"line"))cout<<coord(m.cell)<<" "<<m.s.winner<<" "<<m.s.pending<<" "<<m.s.captures<<"\n";return 0;}
 if(mode=="choose"){string raw=argv[3];State s;for(int i=0;i<81;i++){s.b[i]=raw[i]-'0';s.ply+=s.b[i]!=0;}s.turn=stoi(argv[4]);s.pending=argc>6?stoi(argv[6]):0;Search search;int depth=argc>5?stoi(argv[5]):5;search.width=depth>3?10:14;search.budget=depth>3?50000:10000;auto pick=search.choose(s,depth);cout<<"{\"cell\":"<<pick.first<<",\"coordinate\":\""<<coord(pick.first)<<"\",\"score\":"<<pick.second<<",\"nodes\":"<<search.nodes<<",\"budgetStopped\":"<<(search.stopped?"true":"false")<<",\"proof\":false}\n";return 0;}
 if(mode=="transition"){string raw=argv[3];State s;for(int i=0;i<81;i++){s.b[i]=raw[i]-'0';s.ply+=s.b[i]!=0;}s.turn=stoi(argv[4]);s.pending=argc>6?stoi(argv[6]):0;s.last=argc>7?stoi(argv[7]):-1;State t=step(s,stoi(argv[5]));for(int x:t.b)cout<<x;cout<<" "<<t.winner<<" "<<t.pending<<" "<<t.captures<<"\n";return 0;}
 int games=argc>3?stoi(argv[3]):8,depth=argc>4?stoi(argv[4]):3,split=argc>5?stoi(argv[5]):0;int wins[3]={};long allNodes=0;auto begin=chrono::steady_clock::now();
 // Frozen before development results: separate development and held-out two-ply openings. Same positions tested under seat, color, and strategy flips.
 vector<array<int,2>> openings=split==0?vector<array<int,2>>{{40,30},{40,31},{30,40},{31,49}}:vector<array<int,2>>{{22,32},{20,60},{4,39},{13,50}};
 cout<<"{\"variant\":\""<<variant<<"\",\"depth\":"<<depth<<",\"split\":\""<<(split?"heldout":"development")<<"\",\"games\":[\n";
 for(int g=0;g<games;g++){State s;s.turn=g%2+1;int first=s.turn;auto opening=openings[(g/4)%openings.size()];vector<int> history;for(int c:opening){s=step(s,c);history.push_back(c);}int assignment=(g/2)%2;long nodes=0;int budgetStops=0;while(s.winner<0&&s.ply<81){Search agent;agent.width=depth>3?10:14;agent.budget=depth>3?50000:10000;agent.profile=(s.turn==1)==(assignment==0)?"line":"capture";auto choice=agent.choose(s,depth);nodes+=agent.nodes;budgetStops+=agent.stopped;if(choice.first<0){cerr<<"illegal null move";return 2;}history.push_back(choice.first);s=step(s,choice.first);}wins[s.winner]++;allNodes+=nodes;cout<<(g?",\n":"")<<"{\"id\":"<<g<<",\"opening\":[\""<<coord(opening[0])<<"\",\""<<coord(opening[1])<<"\"],\"first\":"<<first<<",\"linePlayer\":"<<(assignment==0?1:2)<<",\"winner\":"<<s.winner<<",\"firstWon\":"<<(s.winner==first?"true":"false")<<",\"placements\":"<<s.ply<<",\"flips\":"<<s.captures<<",\"nodes\":"<<nodes<<",\"budgetStops\":"<<budgetStops<<",\"moves\":[";for(int j=0;j<(int)history.size();j++)cout<<(j?",":"")<<"\""<<coord(history[j])<<"\"";cout<<"]}";cout.flush();}
 auto ms=chrono::duration_cast<chrono::milliseconds>(chrono::steady_clock::now()-begin).count();cout<<"\n],\"winnerCounts\":["<<wins[0]<<","<<wins[1]<<","<<wins[2]<<"],\"nodes\":"<<allNodes<<",\"elapsedMs\":"<<ms<<",\"proof\":false,\"allLegalRootImmediateResponses\":true,\"quietBeamWidth\":"<<(depth>3?10:14)<<"}\n";
}
